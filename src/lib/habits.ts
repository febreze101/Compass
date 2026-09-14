/**
 * Evergreen tasks — recurring items Compass owns outright rather than
 * representing in Google Tasks, which has no way to hold them honestly: one
 * task kept un-completed destroys its own history, and one task created per
 * day pollutes a list also used from Google's own apps. See
 * docs/UPDATES.md §2.2–§2.3.
 *
 * Mirrors `google/tasks.ts`'s shape — a pure function deciding what applies
 * to a given day, plus thin read/write wrappers — but talks to Supabase,
 * never `GoogleClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDayKey, type DayKey } from './date'

export interface Habit {
  id: string
  title: string
  /**
   * `'daily'`, `'weekdays'` (Mon–Fri), or `'weekly:N'` where N is
   * `Date#getDay()` (0 = Sunday .. 6 = Saturday) — `'weekly:3'` is every
   * Wednesday. Free text on the wire (the `habits.cadence` column is
   * unconstrained `text`, so a future cadence shape is a migration-free
   * addition); anything this module doesn't recognise degrades to "never
   * applies" rather than throwing, so one bad row can't blank the whole day.
   */
  cadence: string
  activeFrom: DayKey
  /** Absent means still running. */
  activeTo?: DayKey
  sort: number
}

const WEEKLY_PATTERN = /^weekly:([0-6])$/

function appliesOnDay(cadence: string, day: DayKey): boolean {
  if (cadence === 'daily') return true
  if (cadence === 'weekdays') {
    const weekday = parseDayKey(day).getDay()
    return weekday >= 1 && weekday <= 5
  }
  const weekly = WEEKLY_PATTERN.exec(cadence)
  if (weekly) return parseDayKey(day).getDay() === Number(weekly[1])
  return false
}

/**
 * The habits that belong on `day`: active on that date (per `activeFrom`/
 * `activeTo`) and due by cadence. Sorted by the same `sort` field the habit
 * list itself orders by, the evergreen analogue of `tasksForDay`'s position
 * sort.
 */
export function habitsForDay(habits: Habit[], day: DayKey): Habit[] {
  return habits
    .filter((h) => h.activeFrom <= day && (!h.activeTo || day <= h.activeTo))
    .filter((h) => appliesOnDay(h.cadence, day))
    .sort((a, b) => a.sort - b.sort)
}

interface RawHabit {
  id: string
  title: string
  cadence: string
  active_from: string
  active_to: string | null
  sort: number
}

function normalizeHabit(raw: RawHabit): Habit {
  return {
    id: raw.id,
    title: raw.title,
    cadence: raw.cadence,
    activeFrom: raw.active_from,
    activeTo: raw.active_to ?? undefined,
    sort: raw.sort,
  }
}

export async function listHabits(client: SupabaseClient): Promise<Habit[]> {
  const { data, error } = await client.from('habits').select('*').order('sort', { ascending: true })
  if (error) throw new Error(`Could not load evergreen tasks: ${error.message}`)
  return (data as RawHabit[]).map(normalizeHabit)
}

export async function createHabit(
  client: SupabaseClient,
  params: { title: string; cadence: string; activeFrom: DayKey },
): Promise<Habit> {
  const title = params.title.trim()
  if (!title) throw new Error('An evergreen task needs a title.')
  const { data, error } = await client
    .from('habits')
    .insert({ title, cadence: params.cadence, active_from: params.activeFrom })
    .select()
    .single()
  if (error) throw new Error(`Could not create the evergreen task: ${error.message}`)
  return normalizeHabit(data as RawHabit)
}

/** Habit ids logged done for `day`. */
export async function listHabitLog(client: SupabaseClient, day: DayKey): Promise<string[]> {
  const { data, error } = await client.from('habit_log').select('habit_id').eq('day', day)
  if (error) throw new Error(`Could not load today's evergreen progress: ${error.message}`)
  return (data as { habit_id: string }[]).map((row) => row.habit_id)
}

/**
 * Checks a habit off for `day`. Upserted on `(user_id, habit_id, day)`
 * rather than inserted, so logging twice (a slow tap, a retry after a
 * dropped connection) doesn't error.
 */
export async function logHabit(client: SupabaseClient, habitId: string, day: DayKey): Promise<void> {
  const { error } = await client.from('habit_log').upsert({ habit_id: habitId, day })
  if (error) throw new Error(`Could not check off the evergreen task: ${error.message}`)
}

/**
 * Un-checks a habit for `day` — unlike a Google Task, this only removes
 * today's log row; every other day's completion history is untouched.
 */
export async function unlogHabit(client: SupabaseClient, habitId: string, day: DayKey): Promise<void> {
  const { error } = await client.from('habit_log').delete().eq('habit_id', habitId).eq('day', day)
  if (error) throw new Error(`Could not un-check the evergreen task: ${error.message}`)
}
