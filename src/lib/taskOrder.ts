/**
 * Local ordering fallback for tasks (docs/UPDATES.md §2.5).
 *
 * Google's `tasks.move` (google/tasks.ts) only reorders within one list —
 * there's no cross-list form. With more than one task list active, Compass
 * keeps its own small sort index in Supabase's `task_positions` table
 * instead, so a drag still sticks rather than silently reverting on the
 * next refresh.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskItem } from './google/types'

/** Positions by task id, for tasks that have ever been locally reordered. */
export async function listTaskPositions(client: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await client.from('task_positions').select('task_id, sort')
  if (error) throw new Error(`Could not load task order: ${error.message}`)
  return Object.fromEntries((data as { task_id: string; sort: number }[]).map((row) => [row.task_id, row.sort]))
}

/** Overwrites the sort index for every task in `order`, front to back. */
export async function saveTaskOrder(client: SupabaseClient, order: string[]): Promise<void> {
  const rows = order.map((taskId, sort) => ({ task_id: taskId, sort }))
  const { error } = await client.from('task_positions').upsert(rows)
  if (error) throw new Error(`Could not save task order: ${error.message}`)
}

/**
 * Applies any saved local order on top of Google's own (position-sorted)
 * order. Tasks with no saved position keep their relative place at the end
 * — a freshly created task shouldn't have to be dragged just to appear.
 */
export function applyLocalOrder(tasks: TaskItem[], positions: Record<string, number>): TaskItem[] {
  if (Object.keys(positions).length === 0) return tasks
  return [...tasks].sort((a, b) => {
    const posA = positions[a.id]
    const posB = positions[b.id]
    if (posA === undefined && posB === undefined) return 0
    if (posA === undefined) return 1
    if (posB === undefined) return -1
    return posA - posB
  })
}

/** Swaps the task at `index` with its neighbor in `direction`, if possible. */
export function reorder<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
