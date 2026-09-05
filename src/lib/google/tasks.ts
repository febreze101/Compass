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

/**
 * The tasks that belong on a given day.
 *
 * Due today, plus anything overdue and still unfinished — an unfinished task
 * from Tuesday is still work you have to do on Wednesday, and hiding it in the
 * past is how things get forgotten. Undated tasks belong to no day and are left
 * for a future backlog view.
 */
export function tasksForDay(tasks: TaskItem[], day: DayKey): TaskItem[] {
  return tasks
    .filter((task) => {
      if (!task.due) return false
      if (task.due === day) return true
      return task.due < day && !task.completed
    })
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.due ?? '').localeCompare(b.due ?? '') ||
        a.position.localeCompare(b.position),
    )
}
