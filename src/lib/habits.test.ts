import { describe, expect, it } from 'vitest'
import { createHabit, habitsForDay, listHabitLog, listHabits, logHabit, unlogHabit, type Habit } from './habits'

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    title: 'Meditate',
    cadence: 'daily',
    activeFrom: '2026-01-01',
    sort: 0,
    ...overrides,
  }
}

// 2026-09-14 is a Monday, 2026-09-16 a Wednesday, 2026-09-19 a Saturday.
const MONDAY = '2026-09-14'
const WEDNESDAY = '2026-09-16'
const SATURDAY = '2026-09-19'

describe('habitsForDay', () => {
  it('includes a daily habit on any day', () => {
    expect(habitsForDay([habit({ cadence: 'daily' })], SATURDAY)).toHaveLength(1)
  })

  it('includes a weekdays habit Monday through Friday, not the weekend', () => {
    const habits = [habit({ cadence: 'weekdays' })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(1)
    expect(habitsForDay(habits, SATURDAY)).toHaveLength(0)
  })

  it('includes a weekly habit only on its matching weekday', () => {
    // weekly:3 is Wednesday (Date#getDay() === 3).
    const habits = [habit({ cadence: 'weekly:3' })]
    expect(habitsForDay(habits, WEDNESDAY)).toHaveLength(1)
    expect(habitsForDay(habits, MONDAY)).toHaveLength(0)
  })

  it('excludes a habit before its activeFrom date', () => {
    const habits = [habit({ activeFrom: '2027-01-01' })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(0)
  })

  it('excludes a habit after its activeTo date', () => {
    const habits = [habit({ activeFrom: '2026-01-01', activeTo: '2026-06-01' })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(0)
  })

  it('includes a still-running habit with no activeTo', () => {
    const habits = [habit({ activeTo: undefined })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(1)
  })

  it('treats an unrecognised cadence as never-applies rather than throwing', () => {
    const habits = [habit({ cadence: 'monthly:15' })]
    expect(habitsForDay(habits, MONDAY)).toEqual([])
  })

  it('sorts by the sort field', () => {
    const habits = [habit({ id: 'b', sort: 2, title: 'B' }), habit({ id: 'a', sort: 1, title: 'A' })]
    expect(habitsForDay(habits, MONDAY).map((h) => h.id)).toEqual(['a', 'b'])
  })
})

/** A minimal Supabase stand-in for the query shapes habits.ts issues. */
function fakeSupabase() {
  const inserted: unknown[] = []
  const upserted: unknown[] = []
  const deleted: { habitId?: string; day?: string } = {}

  const client = {
    from: (table: string) => {
      if (table === 'habits') {
        return {
          select: () => ({
            order: async () => ({
              data: [
                {
                  id: 'h1',
                  title: 'Meditate',
                  cadence: 'daily',
                  active_from: '2026-01-01',
                  active_to: null,
                  sort: 0,
                },
              ],
              error: null,
            }),
          }),
          insert: (row: unknown) => {
            inserted.push(row)
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'h2',
                    title: (row as { title: string }).title,
                    cadence: (row as { cadence: string }).cadence,
                    active_from: (row as { active_from: string }).active_from,
                    active_to: null,
                    sort: 0,
                  },
                  error: null,
                }),
              }),
            }
          },
        }
      }
      // habit_log
      return {
        select: () => ({
          eq: async () => ({ data: [{ habit_id: 'h1' }], error: null }),
        }),
        upsert: async (row: unknown) => {
          upserted.push(row)
          return { error: null }
        },
        delete: () => ({
          eq: (col: string, value: string) => {
            if (col === 'habit_id') deleted.habitId = value
            if (col === 'day') deleted.day = value
            return {
              eq: (col2: string, value2: string) => {
                if (col2 === 'habit_id') deleted.habitId = value2
                if (col2 === 'day') deleted.day = value2
                return Promise.resolve({ error: null })
              },
            }
          },
        }),
      }
    },
  }
  return { client: client as unknown as import('@supabase/supabase-js').SupabaseClient, inserted, upserted, deleted }
}

describe('Supabase wrappers', () => {
  it('listHabits normalizes the raw rows', async () => {
    const { client } = fakeSupabase()
    const habits = await listHabits(client)
    expect(habits).toEqual([
      { id: 'h1', title: 'Meditate', cadence: 'daily', activeFrom: '2026-01-01', activeTo: undefined, sort: 0 },
    ])
  })

  it('createHabit refuses a blank title', async () => {
    const { client } = fakeSupabase()
    await expect(createHabit(client, { title: '  ', cadence: 'daily', activeFrom: MONDAY })).rejects.toThrow(
      /title/i,
    )
  })

  it('createHabit inserts and normalizes the created row', async () => {
    const { client, inserted } = fakeSupabase()
    const created = await createHabit(client, { title: 'Read', cadence: 'daily', activeFrom: MONDAY })
    expect(created).toMatchObject({ id: 'h2', title: 'Read', cadence: 'daily' })
    expect(inserted).toEqual([{ title: 'Read', cadence: 'daily', active_from: MONDAY }])
  })

  it('listHabitLog returns the logged habit ids for a day', async () => {
    const { client } = fakeSupabase()
    expect(await listHabitLog(client, MONDAY)).toEqual(['h1'])
  })

  it('logHabit upserts a log row', async () => {
    const { client, upserted } = fakeSupabase()
    await logHabit(client, 'h1', MONDAY)
    expect(upserted).toEqual([{ habit_id: 'h1', day: MONDAY }])
  })

  it('unlogHabit deletes the matching log row', async () => {
    const { client, deleted } = fakeSupabase()
    await unlogHabit(client, 'h1', MONDAY)
    expect(deleted).toEqual({ habitId: 'h1', day: MONDAY })
  })
})
