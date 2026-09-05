import { create } from 'zustand'
import { todayKey, type DayKey } from '../lib/date'
import { createGoogleClient, AuthRequiredError, type GoogleClient } from '../lib/google/client'
import { listCalendars, listEvents } from '../lib/google/calendar'
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

  boot: () => Promise<void>
  signIn: () => Promise<void>
  disconnect: () => Promise<void>
  goToDay: (day: DayKey) => Promise<void>
  refresh: () => Promise<void>
  toggleCalendar: (id: string) => Promise<void>
  toggleTaskList: (id: string) => Promise<void>
  toggleTask: (task: TaskItem) => Promise<void>
  addTask: (title: string) => Promise<void>
  dismissError: () => void
}

/** Applies `change` to one task wherever it appears in the day's lists. */
function patchTask(state: AppState, id: string, change: Partial<TaskItem>) {
  const apply = (list: TaskItem[]) =>
    list.map((task) => (task.id === id ? { ...task, ...change } : task))
  return { tasks: apply(state.tasks), undated: apply(state.undated) }
}

const host = platform()

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

  async boot() {
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
    set({ day })
    await get().refresh()
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
        events: eventPages.flat().sort((a, b) => a.start.getTime() - b.start.getTime()),
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
