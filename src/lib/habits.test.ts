import { describe, expect, it } from 'vitest'
import {
  createHabit,
  habitsForDay,
  listHabitLog,
  listHabits,
  logHabit,
  monthlyCadence,
  unlogHabit,
  weeklyCadence,
  type Habit,
} from './habits'

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
    // weekly:1:3 is every week on Wednesday (Date#getDay() === 3).
    const habits = [habit({ cadence: 'weekly:1:3' })]
    expect(habitsForDay(habits, WEDNESDAY)).toHaveLength(1)
    expect(habitsForDay(habits, MONDAY)).toHaveLength(0)
  })

  it('includes a habit on every one of several weekdays', () => {
    // weekly:1:1,3,5 is every Monday, Wednesday and Friday.
    const habits = [habit({ cadence: 'weekly:1:1,3,5', activeFrom: MONDAY })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(1)
    expect(habitsForDay(habits, WEDNESDAY)).toHaveLength(1)
    expect(habitsForDay(habits, SATURDAY)).toHaveLength(0)
  })

  it('skips alternating weeks for an every-other-week cadence (garbage day)', () => {
    // weekly:2:1 anchored to a Monday: that Monday, then every other one.
    const habits = [habit({ cadence: 'weekly:2:1', activeFrom: MONDAY })]
    expect(habitsForDay(habits, MONDAY)).toHaveLength(1) // week 0 — applies
    expect(habitsForDay(habits, '2026-09-21')).toHaveLength(0) // week 1 — skipped
    expect(habitsForDay(habits, '2026-09-28')).toHaveLength(1) // week 2 — applies
  })

  it('applies a monthly habit only on its day of month', () => {
    const habits = [habit({ cadence: 'monthly:1:15', activeFrom: '2026-01-01' })]
    expect(habitsForDay(habits, '2026-09-15')).toHaveLength(1)
    expect(habitsForDay(habits, '2026-09-16')).toHaveLength(0)
  })

  it('skips two months out of three for a quarterly cadence', () => {
    const habits = [habit({ cadence: 'monthly:3:15', activeFrom: '2026-01-15' })]
    expect(habitsForDay(habits, '2026-01-15')).toHaveLength(1) // month 0 — applies
    expect(habitsForDay(habits, '2026-02-15')).toHaveLength(0) // month 1 — skipped
    expect(habitsForDay(habits, '2026-03-15')).toHaveLength(0) // month 2 — skipped
    expect(habitsForDay(habits, '2026-04-15')).toHaveLength(1) // month 3 — applies
  })

  it('skips a day-of-month that a shorter month never reaches, rather than rolling over', () => {
    const habits = [habit({ cadence: 'monthly:1:31', activeFrom: '2026-01-01' })]
    expect(habitsForDay(habits, '2026-02-28')).toHaveLength(0)
    expect(habitsForDay(habits, '2026-01-31')).toHaveLength(1)
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
    const habits = [habit({ cadence: 'yearly:03-15' })]
    expect(habitsForDay(habits, MONDAY)).toEqual([])
  })

  it('sorts by the sort field', () => {
    const habits = [habit({ id: 'b', sort: 2, title: 'B' }), habit({ id: 'a', sort: 1, title: 'A' })]
    expect(habitsForDay(habits, MONDAY).map((h) => h.id)).toEqual(['a', 'b'])
  })
})

describe('weeklyCadence', () => {
  it('builds an every-week cadence for a single day', () => {
    expect(weeklyCadence(1, [2])).toBe('weekly:1:2')
  })

  it('dedupes and sorts multiple days', () => {
    expect(weeklyCadence(1, [5, 1, 1, 3])).toBe('weekly:1:1,3,5')
  })

  it('floors an interval below 1', () => {
    expect(weeklyCadence(0, [2])).toBe('weekly:1:2')
  })
})

describe('monthlyCadence', () => {
  it('builds a monthly cadence', () => {
    expect(monthlyCadence(1, 15)).toBe('monthly:1:15')
  })

  it('builds a quarterly cadence', () => {
    expect(monthlyCadence(3, 1)).toBe('monthly:3:1')
  })

  it('clamps the day of month to 1-31', () => {
    expect(monthlyCadence(1, 45)).toBe('monthly:1:31')
    expect(monthlyCadence(1, 0)).toBe('monthly:1:1')
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
