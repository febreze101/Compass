import { describe, expect, it } from 'vitest'
import { applyLocalOrder, listTaskPositions, reorder, saveTaskOrder } from './taskOrder'
import type { TaskItem } from './google/types'

const task = (id: string): TaskItem => ({
  id,
  listId: 'l1',
  title: id,
  completed: false,
  position: '0',
})

describe('applyLocalOrder', () => {
  it('leaves tasks alone when nothing has been locally reordered', () => {
    const tasks = [task('a'), task('b')]
    expect(applyLocalOrder(tasks, {})).toEqual(tasks)
  })

  it('sorts by the saved position', () => {
    const tasks = [task('a'), task('b'), task('c')]
    expect(applyLocalOrder(tasks, { a: 2, b: 0, c: 1 }).map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps a task with no saved position after every positioned one', () => {
    const tasks = [task('a'), task('b'), task('new')]
    expect(applyLocalOrder(tasks, { a: 1, b: 0 }).map((t) => t.id)).toEqual(['b', 'a', 'new'])
  })
})

describe('reorder', () => {
  it('swaps with the previous item moving up', () => {
    expect(reorder(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c'])
  })

  it('swaps with the next item moving down', () => {
    expect(reorder(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b'])
  })

  it('does nothing moving the first item up', () => {
    expect(reorder(['a', 'b', 'c'], 0, 'up')).toEqual(['a', 'b', 'c'])
  })

  it('does nothing moving the last item down', () => {
    expect(reorder(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c'])
  })
})

function fakeSupabase(rows: { task_id: string; sort: number }[]) {
  const upserted: unknown[] = []
  const client = {
    from: () => ({
      select: async () => ({ data: rows, error: null }),
      upsert: async (payload: unknown) => {
        upserted.push(payload)
        return { error: null }
      },
    }),
  }
  return { client: client as unknown as import('@supabase/supabase-js').SupabaseClient, upserted }
}

describe('Supabase wrappers', () => {
  it('listTaskPositions returns a map keyed by task id', async () => {
    const { client } = fakeSupabase([{ task_id: 't1', sort: 0 }, { task_id: 't2', sort: 1 }])
    expect(await listTaskPositions(client)).toEqual({ t1: 0, t2: 1 })
  })

  it('saveTaskOrder upserts consecutive positions for the given order', async () => {
    const { client, upserted } = fakeSupabase([])
    await saveTaskOrder(client, ['t2', 't1', 't3'])
    expect(upserted).toEqual([
      [
        { task_id: 't2', sort: 0 },
        { task_id: 't1', sort: 1 },
        { task_id: 't3', sort: 2 },
      ],
    ])
  })
})
