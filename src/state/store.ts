import { create } from 'zustand'
import { dayKeyOf, todayKey, type DayKey } from '../lib/date'
import { classifyCapture } from '../lib/capture'
import { createGoogleClient, AuthRequiredError, type GoogleClient } from '../lib/google/client'
import {
  createEvent,
  defaultWriteCalendar,
  deleteEvent,
  listCalendars,
  listEvents,
  updateEvent,
  type EventDraft,
} from '../lib/google/calendar'
import {
  createTask,
  listTaskLists,
  listTasks,
  setTaskCompleted,
  tasksForDay,
  undatedTasks,
} from '../lib/google/tasks'
import type { Calendar, CalendarEvent, TaskItem, TaskList } from '../lib/google/types'
import { describeMissingScopes, missingScopes } from '../lib/google/scopes'
import { createNoteSaver } from '../lib/notes'
import { loadSelection, resolveSelection, saveSelection } from '../lib/prefs'
import { beginSignIn, completeSignIn, createTokenStore, restoreSession, signOut } from '../lib/session'
import { platform } from '../platform'

type Status = 'booting' | 'signed-out' | 'signed-in'

interface AppState {
  status: Status
  error: string | null
  /** A missing-permission problem: persists until the user reconnects. */
  scopeGap: string | null
  day: DayKey

  calendars: Calendar[]
  taskLists: TaskList[]
  selectedCalendarIds: string[]
  selectedTaskListIds: string[]

  events: CalendarEvent[]
  tasks: TaskItem[]
  undated: TaskItem[]
  loadingDay: boolean

  /** The day's note. Compass owns this outright — see docs/SCOPE.md §4. */
  note: string
  noteLoading: boolean
  noteSaving: boolean
  /** Days that already have a note, for marking them in the date bar. */
  daysWithNotes: DayKey[]

  boot: () => Promise<void>
  signIn: () => Promise<void>
  disconnect: () => Promise<void>
  goToDay: (day: DayKey) => Promise<void>
  refresh: () => Promise<void>
  toggleCalendar: (id: string) => Promise<void>
  toggleTaskList: (id: string) => Promise<void>
  toggleTask: (task: TaskItem) => Promise<void>
  addTask: (title: string) => Promise<void>
  addEvent: (draft: EventDraft) => Promise<void>
  /**
   * Report whether the write landed, unlike the fire-and-forget adders: the
   * editor has to stay open on failure, or the user loses what they typed.
   */
  saveEvent: (event: CalendarEvent, draft: EventDraft) => Promise<boolean>
  removeEvent: (event: CalendarEvent) => Promise<boolean>
  /** One input, routed by whether it carries a time. See docs/SCOPE.md §8.6. */
  capture: (input: { title: string; time?: string }) => Promise<void>
  editNote: (text: string) => void
  /** Writes any outstanding edit now — on the way out of a day, or the app. */
  flushNote: () => Promise<void>
  /** Holds the app's exit open until the note is written. Returns an unsubscribe. */
  watchExit: () => () => void
  /** Opens a link from a note in the real browser, not the webview. */
  openLink: (href: string) => void
  dismissError: () => void
}

/**
 * Chronological, which for an all-day event means first: its start is local
 * midnight. Shared by every path that puts events into state so a freshly
 * written one lands exactly where a refresh would have put it.
 */
function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return a.start.getTime() - b.start.getTime()
}

/** Event ids are unique per calendar, not globally. */
function sameEvent(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.id === b.id && a.calendarId === b.calendarId
}

/** Applies `change` to one task wherever it appears in the day's lists. */
function patchTask(state: AppState, id: string, change: Partial<TaskItem>) {
  const apply = (list: TaskItem[]) =>
    list.map((task) => (task.id === id ? { ...task, ...change } : task))
  return { tasks: apply(state.tasks), undated: apply(state.undated) }
}

const host = platform()

/**
 * Autosave for the note. Module-level, so one saver serves the whole session
 * and an edit can't be stranded by a component unmounting mid-write.
 */
const noteSaver = createNoteSaver({
  write: (day, text) => host.notes.write(day, text),
  onError: (error) => useApp.setState({ error: describe(error) }),
  onBusyChange: (busy) => {
    useApp.setState({ noteSaving: busy })
    // Once the disk is quiet, a note may have appeared or been emptied away,
    // so the date-bar markers are restated.
    if (!busy) void refreshNoteDays()
  },
})

async function loadNote(day: DayKey): Promise<void> {
  useApp.setState({ noteLoading: true })
  try {
    const text = await host.notes.read(day)
    // Guarded because reads race: a slow one for a day already navigated away
    // from must not paint over the note now on screen.
    if (useApp.getState().day === day) useApp.setState({ note: text, noteLoading: false })
  } catch (error) {
    if (useApp.getState().day === day) {
      useApp.setState({ note: '', noteLoading: false, error: describe(error) })
    }
  }
}

async function refreshNoteDays(): Promise<void> {
  try {
    useApp.setState({ daysWithNotes: await host.notes.listDaysWithNotes() })
  } catch {
    // Decoration only. A note store that can't be listed shouldn't raise an
    // error over a page that is otherwise working.
  }
}

let client: GoogleClient | null = null
function googleClient(): GoogleClient {
  client ??= createGoogleClient({
    tokens: createTokenStore(host),
    credentials: host.oauth.credentials(),
    onSignedOut: () =>
      useApp.setState({ status: 'signed-out', events: [], tasks: [], undated: [] }),
  })
  return client
}

function describe(error: unknown): string {
  if (error instanceof AuthRequiredError) return `${error.message} Sign in again to continue.`
  const message = error instanceof Error ? error.message : String(error)

  // Google's wording for a missing scope names neither the permission nor the
  // fix, and it surfaces on an ordinary data request long after sign-in. Which
  // scope is missing isn't knowable from the failure itself — the boot-time
  // check in `boot()` is the one that can name it.
  if (/insufficient authentication scopes/i.test(message)) {
    return (
      'Google rejected that request for lack of permission. Disconnect and sign in ' +
      'again, keeping every permission ticked on the consent screen. If it persists, ' +
      'remove Compass at myaccount.google.com/permissions first, then reconnect.'
    )
  }
  return message
}

export const useApp = create<AppState>()((set, get) => ({
  status: 'booting',
  error: null,
  scopeGap: null,
  day: todayKey(),
  calendars: [],
  taskLists: [],
  selectedCalendarIds: [],
  selectedTaskListIds: [],
  events: [],
  tasks: [],
  undated: [],
  loadingDay: false,
  note: '',
  noteLoading: false,
  noteSaving: false,
  daysWithNotes: [],

  async boot() {
    // Notes are local and owed nothing by Google, so they load on their own
    // schedule rather than behind sign-in.
    void loadNote(get().day)
    void refreshNoteDays()

    try {
      // An OAuth callback takes priority: the app booted *into* the redirect.
      const redirect = host.oauth.consumeRedirect()
      const tokens = redirect ? await completeSignIn(host, redirect) : await restoreSession(host)
      if (!tokens) {
        set({ status: 'signed-out' })
        return
      }

      // Caught here rather than as a 403 four requests later, so the message
      // names the missing permission instead of the failing endpoint.
      set({
        status: 'signed-in',
        error: null,
        scopeGap: describeMissingScopes(missingScopes(tokens.scope)) || null,
      })
      await loadSources(set, get)
    } catch (error) {
      set({ status: 'signed-out', error: describe(error) })
    }
  },

  async signIn() {
    try {
      set({ error: null })
      await beginSignIn(host)
      // Reached only on platforms that capture the redirect in-process; in the
      // browser the page has already navigated to Google by now.
      set({ status: 'signed-in' })
      await loadSources(set, get)
    } catch (error) {
      set({ error: describe(error) })
    }
  },

  async disconnect() {
    await signOut(host)
    client = null
    set({
      status: 'signed-out',
      calendars: [],
      taskLists: [],
      events: [],
      tasks: [],
      undated: [],
      error: null,
      scopeGap: null,
    })
  },

  async goToDay(day) {
    // The outstanding edit belongs to the day being left, so it goes to disk
    // before `day` moves underneath it.
    await noteSaver.flush()
    set({ day, note: '' })
    await Promise.all([get().refresh(), loadNote(day)])
  },

  async refresh() {
    if (get().status !== 'signed-in') return
    const { day, selectedCalendarIds, selectedTaskListIds } = get()
    set({ loadingDay: true, error: null })
    try {
      const api = googleClient()
      const [eventPages, taskPages] = await Promise.all([
        Promise.all(
          selectedCalendarIds.map((calendarId) => listEvents(api, { calendarId, day })),
        ),
        Promise.all(selectedTaskListIds.map((listId) => listTasks(api, { listId }))),
      ])

      const allTasks = taskPages.flat()
      set({
        events: eventPages.flat().sort(byStart),
        tasks: tasksForDay(allTasks, day),
        undated: undatedTasks(allTasks),
        loadingDay: false,
      })
    } catch (error) {
      set({ loadingDay: false, error: describe(error) })
    }
  },

  async toggleCalendar(id) {
    const next = toggle(get().selectedCalendarIds, id)
    set({ selectedCalendarIds: next })
    saveSelection('calendars', { selected: next, known: get().calendars.map((c) => c.id) })
    await get().refresh()
  },

  async toggleTaskList(id) {
    const next = toggle(get().selectedTaskListIds, id)
    set({ selectedTaskListIds: next })
    saveSelection('taskLists', { selected: next, known: get().taskLists.map((l) => l.id) })
    await get().refresh()
  },

  async toggleTask(task) {
    const next = !task.completed
    // Applied before the request so the tick is instant; a checkbox that waits
    // on a round trip feels broken even when it works.
    set(patchTask(get(), task.id, { completed: next }))
    try {
      await setTaskCompleted(googleClient(), {
        listId: task.listId,
        taskId: task.id,
        completed: next,
      })
    } catch (error) {
      set({ ...patchTask(get(), task.id, { completed: task.completed }), error: describe(error) })
    }
  },

  async addTask(title) {
    const { day, selectedTaskListIds } = get()
    const listId = selectedTaskListIds[0]
    if (!listId) {
      set({ error: 'Turn on a task list under Sources before adding a task.' })
      return
    }
    try {
      const created = await createTask(googleClient(), { listId, title, due: day })
      // Re-sorted through the same path the API results take, so a new task
      // lands where a refresh would have put it.
      set({ tasks: tasksForDay([...get().tasks, created], day) })
    } catch (error) {
      set({ error: describe(error) })
    }
  },

  async addEvent(draft) {
    const target = defaultWriteCalendar(get().calendars, get().selectedCalendarIds)
    if (!target) {
      set({ error: 'Turn on a calendar you can edit under Sources before adding an event.' })
      return
    }
    try {
      const created = await createEvent(googleClient(), { calendarId: target.id, draft })
      // Google decides the final times, so where it belongs is answered by what
      // came back rather than by what was asked for.
      if (dayKeyOf(created.start) === get().day) {
        set({ events: [...get().events, created].sort(byStart) })
      }
    } catch (error) {
      set({ error: describe(error) })
    }
  },

  async saveEvent(event, draft) {
    try {
      const updated = await updateEvent(googleClient(), {
        calendarId: event.calendarId,
        eventId: event.id,
        draft,
      })
      const remaining = get().events.filter((e) => !sameEvent(e, event))
      // Moved off the day being viewed, it simply leaves — the alternative is
      // showing it under a date it no longer falls on.
      set({
        events:
          dayKeyOf(updated.start) === get().day
            ? [...remaining, updated].sort(byStart)
            : remaining,
      })
      return true
    } catch (error) {
      set({ error: describe(error) })
      return false
    }
  },

  async removeEvent(event) {
    const previous = get().events
    // Removed first, like the task checkbox: a deletion that waits on a round
    // trip reads as a click that didn't register.
    set({ events: previous.filter((e) => !sameEvent(e, event)) })
    try {
      await deleteEvent(googleClient(), { calendarId: event.calendarId, eventId: event.id })
      return true
    } catch (error) {
      set({ events: previous, error: describe(error) })
      return false
    }
  },

  async capture(input) {
    const captured = classifyCapture(input)
    if (!captured) return
    if (captured.kind === 'task') {
      await get().addTask(captured.title)
      return
    }
    await get().addEvent({
      title: captured.title,
      day: get().day,
      startTime: captured.startTime,
    })
  },

  editNote(text) {
    // Applied to state immediately and to disk shortly after — the textarea is
    // controlled, so anything slower would fight the user's typing.
    set({ note: text })
    noteSaver.queue(get().day, text)
  },

  flushNote: () => noteSaver.flush(),

  watchExit: () => host.onBeforeExit(() => noteSaver.flush()),

  openLink(href) {
    void host.openExternal(href).catch((error: unknown) => set({ error: describe(error) }))
  },

  dismissError: () => set({ error: null }),
}))

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/** Loads the source lists once per session, then the current day. */
async function loadSources(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const api = googleClient()
  const [calendars, taskLists] = await Promise.all([listCalendars(api), listTaskLists(api)])
  set({
    calendars,
    taskLists,
    selectedCalendarIds: resolveSelection(
      calendars.map((c) => c.id),
      loadSelection('calendars'),
    ),
    selectedTaskListIds: resolveSelection(
      taskLists.map((l) => l.id),
      loadSelection('taskLists'),
    ),
  })
  await get().refresh()
}
