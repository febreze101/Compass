import { describe, expect, it, vi } from 'vitest'
import { listTaskLists, listTasks, tasksForDay, undatedTasks } from './tasks'
import type { GoogleClient } from './client'
import type { TaskItem } from './types'

function clientReturning(...pages: unknown[]): GoogleClient & { urls: string[] } {
  const urls: string[] = []
  let call = 0
  return {
    urls,
    request: vi.fn(async (url: string) => {
      urls.push(url)
      return pages[Math.min(call++, pages.length - 1)]
    }),
  } as unknown as GoogleClient & { urls: string[] }
}

describe('listTaskLists', () => {
  it('normalizes task lists', async () => {
    const client = clientReturning({ items: [{ id: 'l1', title: 'My Tasks' }] })
    expect(await listTaskLists(client)).toEqual([{ id: 'l1', title: 'My Tasks' }])
  })
})

describe('listTasks', () => {
  it('asks for completed and hidden tasks so the day view is complete', async () => {
    const client = clientReturning({ items: [] })
    await listTasks(client, { listId: 'l1' })
    const url = new URL(client.urls[0])
    expect(url.pathname).toContain('/lists/l1/tasks')
    expect(url.searchParams.get('showCompleted')).toBe('true')
    expect(url.searchParams.get('showHidden')).toBe('true')
  })

  it('tags tasks with their list and normalizes the due day', async () => {
    const client = clientReturning({
      items: [
        { id: 't1', title: 'Renew passport', status: 'needsAction', due: '2026-09-05T00:00:00.000Z' },
      ],
    })
    const [task] = await listTasks(client, { listId: 'l1' })
    expect(task).toMatchObject({ id: 't1', listId: 'l1', due: '2026-09-05', completed: false })
  })

  it('follows pagination', async () => {
    const client = clientReturning({ items: [{ id: 'a' }], nextPageToken: 'p2' }, { items: [{ id: 'b' }] })
    expect(await listTasks(client, { listId: 'l1' })).toHaveLength(2)
    expect(client.urls[1]).toContain('pageToken=p2')
  })

  it('excludes tasks Google marked deleted', async () => {
    const client = clientReturning({
      items: [
        { id: 'a', status: 'needsAction' },
        { id: 'b', status: 'needsAction', deleted: true },
      ],
    })
    expect((await listTasks(client, { listId: 'l1' })).map((t) => t.id)).toEqual(['a'])
  })
})

describe('tasksForDay', () => {
  const task = (over: Partial<TaskItem>): TaskItem => ({
    id: 'x',
    listId: 'l1',
    title: 't',
    completed: false,
    position: '0',
    ...over,
  })

  it('includes tasks due on the day', () => {
    const due = task({ id: 'today', due: '2026-09-05' })
    expect(tasksForDay([due], '2026-09-05').map((t) => t.id)).toEqual(['today'])
  })

  it('leaves overdue tasks on their own day rather than carrying them forward', () => {
    // A missed task stays where it was scheduled; a dedicated overdue view is
    // the planned home for it. See docs/SCOPE.md §8.7.
    const overdue = task({ id: 'late', due: '2026-09-01' })
    expect(tasksForDay([overdue], '2026-09-05')).toEqual([])
    expect(tasksForDay([overdue], '2026-09-01').map((t) => t.id)).toEqual(['late'])
  })

  it('leaves future tasks out', () => {
    expect(tasksForDay([task({ due: '2026-09-09' })], '2026-09-05')).toEqual([])
  })

  it('excludes undated tasks, which belong to no particular day', () => {
    expect(tasksForDay([task({ due: undefined })], '2026-09-05')).toEqual([])
  })

  it('sorts incomplete before complete, then by position', () => {
    const items = [
      task({ id: 'done', due: '2026-09-05', completed: true, position: '0' }),
      task({ id: 'b', due: '2026-09-05', position: '2' }),
      task({ id: 'a', due: '2026-09-05', position: '1' }),
    ]
    expect(tasksForDay(items, '2026-09-05').map((t) => t.id)).toEqual(['a', 'b', 'done'])
  })
})

describe('undatedTasks', () => {
  const task = (over: Partial<TaskItem>): TaskItem => ({
    id: 'x',
    listId: 'l1',
    title: 't',
    completed: false,
    position: '0',
    ...over,
  })

  it('finds tasks Google holds with no due date', () => {
    // Compass always sets a date on tasks it creates, but tasks made in the
    // Google apps may have none — and would otherwise be invisible here.
    const items = [task({ id: 'none' }), task({ id: 'dated', due: '2026-09-05' })]
    expect(undatedTasks(items).map((t) => t.id)).toEqual(['none'])
  })

  it('ignores completed undated tasks', () => {
    expect(undatedTasks([task({ id: 'done', completed: true })])).toEqual([])
  })
})
