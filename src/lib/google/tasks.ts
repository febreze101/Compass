/**
 * Google Tasks reads, plus the day-selection rule.
 *
 * Tasks has no server-side notion of "what's on today", so Compass fetches a
 * list wholesale and decides locally. Volumes are small enough that this is
 * cheaper than repeated filtered queries, and it lets overdue work surface on
 * today rather than disappearing into the past.
 */

import type { DayKey } from '../date'
import type { GoogleClient } from './client'
import { normalizeTask, normalizeTaskList } from './normalize'
import { collectPages } from './paginate'
import type { RawGoogleTask, RawGoogleTaskList, TaskItem, TaskList } from './types'

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

export async function listTaskLists(client: GoogleClient): Promise<TaskList[]> {
  const raw = await collectPages<RawGoogleTaskList>(client, (pageToken) => {
    const query = new URLSearchParams({ maxResults: '100' })
    if (pageToken) query.set('pageToken', pageToken)
    return `${TASKS_API}/users/@me/lists?${query}`
  })
  return raw.map(normalizeTaskList)
}

/**
 * Every task in a list, completed ones included.
 *
 * `showHidden` matters: Google hides completed tasks from its own default view,
 * and without it a task the user ticked off this morning would vanish from
 * today instead of showing as done.
 */
export async function listTasks(
  client: GoogleClient,
  params: { listId: string },
): Promise<TaskItem[]> {
  const raw = await collectPages<RawGoogleTask>(client, (pageToken) => {
    const query = new URLSearchParams({
      showCompleted: 'true',
      showHidden: 'true',
      maxResults: '100',
    })
    if (pageToken) query.set('pageToken', pageToken)
    return `${TASKS_API}/lists/${encodeURIComponent(params.listId)}/tasks?${query}`
  })

  return raw.filter((task) => task.deleted !== true).map((task) => normalizeTask(task, params.listId))
}

function taskUrl(listId: string, taskId: string): string {
  return `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`
}

function jsonRequest(method: string, payload?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }
}

/**
 * A due day as the timestamp Google wants.
 *
 * Built by string concatenation on purpose: constructing a `Date` from the day
 * and serialising it would shift the date by one for anyone behind UTC. Google
 * discards the time portion anyway — see docs/SCOPE.md §7.
 */
function dueTimestamp(day: DayKey): string {
  return `${day}T00:00:00.000Z`
}

/**
 * Ticks or un-ticks a task.
 *
 * Un-completing needs `completed: null` as well as the status change — Google
 * otherwise keeps the old completion timestamp alongside a `needsAction`
 * status and rejects the inconsistent pair.
 */
export async function setTaskCompleted(
  client: GoogleClient,
  params: { listId: string; taskId: string; completed: boolean },
): Promise<TaskItem> {
  const patch = params.completed
    ? { status: 'completed' }
    : { status: 'needsAction', completed: null }
  const updated = await client.request<RawGoogleTask>(
    taskUrl(params.listId, params.taskId),
    jsonRequest('PATCH', patch),
  )
  return normalizeTask(updated, params.listId)
}

/**
 * Creates a task. A due day is required, not optional: an undated task has
 * nowhere to appear in a day-based app. See docs/SCOPE.md §8.8.
 */
export async function createTask(
  client: GoogleClient,
  params: { listId: string; title: string; due: DayKey; notes?: string },
): Promise<TaskItem> {
  const title = params.title.trim()
  if (!title) throw new Error('A task needs a title.')
  if (!params.due) throw new Error('A task needs a due day.')

  const created = await client.request<RawGoogleTask>(
    `${TASKS_API}/lists/${encodeURIComponent(params.listId)}/tasks`,
    jsonRequest('POST', { title, due: dueTimestamp(params.due), notes: params.notes }),
  )
  return normalizeTask(created, params.listId)
}

/** Patches whichever fields are supplied, leaving the rest untouched. */
export async function updateTask(
  client: GoogleClient,
  params: { listId: string; taskId: string; title?: string; notes?: string; due?: DayKey },
): Promise<TaskItem> {
  const patch: Record<string, unknown> = {}
  if (params.title !== undefined) patch.title = params.title
  if (params.notes !== undefined) patch.notes = params.notes
  if (params.due !== undefined) patch.due = dueTimestamp(params.due)

  const updated = await client.request<RawGoogleTask>(
    taskUrl(params.listId, params.taskId),
    jsonRequest('PATCH', patch),
  )
  return normalizeTask(updated, params.listId)
}

export async function deleteTask(
  client: GoogleClient,
  params: { listId: string; taskId: string },
): Promise<void> {
  await client.request<void>(taskUrl(params.listId, params.taskId), jsonRequest('DELETE'))
}

/**
 * The tasks that belong on a given day: exactly those due that day.
 *
 * A missed task stays on the day it was scheduled rather than following the
 * user forward — the day view stays an honest record of what was planned, and
 * overdue work gets its own view later. See docs/SCOPE.md §8.7.
 */
export function tasksForDay(tasks: TaskItem[], day: DayKey): TaskItem[] {
  return tasks
    .filter((task) => task.due === day)
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) || a.position.localeCompare(b.position),
    )
}

/**
 * Unfinished tasks Google holds with no due date.
 *
 * Compass always dates the tasks it creates, but tasks made in Google's own
 * apps may have none. Without somewhere to surface them they would simply be
 * invisible here, which is worse than showing them somewhere imperfect.
 */
export function undatedTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks
    .filter((task) => !task.due && !task.completed)
    .sort((a, b) => a.position.localeCompare(b.position))
}
