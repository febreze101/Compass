import { describe, expect, it, vi } from 'vitest'
import {
  createTask,
  deleteTask,
  listTaskLists,
  listTasks,
  setTaskCompleted,
  tasksForDay,
  undatedTasks,
  updateTask,
} from './tasks'
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

function recordingClient(response: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const client = {
    calls,
    request: vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return response
    }),
  }
  return client as unknown as GoogleClient & typeof client
}

const body = (init?: RequestInit) => JSON.parse((init?.body as string) ?? '{}')

describe('setTaskCompleted', () => {
  it('patches the task to completed', async () => {
    const client = recordingClient({ id: 't1', status: 'completed' })
    await setTaskCompleted(client, { listId: 'l1', taskId: 't1', completed: true })

    const [call] = client.calls
    expect(call.url).toContain('/lists/l1/tasks/t1')
    expect(call.init?.method).toBe('PATCH')
    expect(body(call.init).status).toBe('completed')
  })

  it('clears the completion timestamp when un-completing', async () => {
    // Setting status back to needsAction is not enough: Google keeps the
    // `completed` timestamp and rejects the combination. It has to be nulled.
    const client = recordingClient({ id: 't1', status: 'needsAction' })
    await setTaskCompleted(client, { listId: 'l1', taskId: 't1', completed: false })

    const patch = body(client.calls[0].init)
    expect(patch.status).toBe('needsAction')
    expect(patch.completed).toBeNull()
  })

  it('returns the normalized task Google echoes back', async () => {
    const client = recordingClient({ id: 't1', title: 'Done thing', status: 'completed' })
    const task = await setTaskCompleted(client, { listId: 'l1', taskId: 't1', completed: true })
    expect(task).toMatchObject({ id: 't1', listId: 'l1', completed: true })
  })
})

describe('createTask', () => {
  it('posts to the list with a title and due day', async () => {
    const client = recordingClient({ id: 'new', title: 'Buy milk', status: 'needsAction' })
    await createTask(client, { listId: 'l1', title: 'Buy milk', due: '2026-09-05' })

    const [call] = client.calls
    expect(call.url).toContain('/lists/l1/tasks')
    expect(call.init?.method).toBe('POST')
    expect(body(call.init).title).toBe('Buy milk')
  })

  it('sends the due day as UTC midnight, built from the string', async () => {
    // Routing the day through a local Date would send the previous day for
    // anyone behind UTC. The API wants a timestamp but only reads the date.
    const client = recordingClient({ id: 'new', status: 'needsAction' })
    await createTask(client, { listId: 'l1', title: 'x', due: '2026-09-05' })
    expect(body(client.calls[0].init).due).toBe('2026-09-05T00:00:00.000Z')
  })

  it('rejects a task with no due day', async () => {
    // Compass always dates the tasks it creates — an undated task has nowhere
    // to appear in a day-based app. See docs/SCOPE.md §8.8.
    const client = recordingClient()
    await expect(
      createTask(client, { listId: 'l1', title: 'x', due: '' }),
    ).rejects.toThrow(/due/i)
  })

  it('rejects an empty title', async () => {
    const client = recordingClient()
    await expect(
      createTask(client, { listId: 'l1', title: '   ', due: '2026-09-05' }),
    ).rejects.toThrow(/title/i)
  })
})

describe('updateTask', () => {
  it('patches only the fields given', async () => {
    const client = recordingClient({ id: 't1', status: 'needsAction' })
    await updateTask(client, { listId: 'l1', taskId: 't1', title: 'Renamed' })

    expect(client.calls[0].init?.method).toBe('PATCH')
    const patch = body(client.calls[0].init)
    expect(patch).toEqual({ title: 'Renamed' })
  })

  it('reschedules by sending a new due timestamp', async () => {
    const client = recordingClient({ id: 't1', status: 'needsAction' })
    await updateTask(client, { listId: 'l1', taskId: 't1', due: '2026-12-25' })
    expect(body(client.calls[0].init).due).toBe('2026-12-25T00:00:00.000Z')
  })
})

describe('deleteTask', () => {
  it('deletes the task', async () => {
    const client = recordingClient()
    await deleteTask(client, { listId: 'l1', taskId: 't1' })
    expect(client.calls[0].url).toContain('/lists/l1/tasks/t1')
    expect(client.calls[0].init?.method).toBe('DELETE')
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
