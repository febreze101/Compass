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
   * Free text on the wire (the `habits.cadence` column is unconstrained
   * `text`, so this grammar can grow without a migration); anything this
   * module doesn't recognise degrades to "never applies" rather than
   * throwing, so one bad row can't blank the whole day. Recognised forms:
   *
   * - `'daily'` — every day.
   * - `'weekdays'` — Monday through Friday.
   * - `'weekly:<N>:<days>'` — every `N` weeks, on the given weekdays
   *   (`Date#getDay()` numbers, 0 = Sunday .. 6 = Saturday, comma-separated
   *   for more than one day a week). `'weekly:1:2'` is every Tuesday;
   *   `'weekly:2:2'` is every *other* Tuesday (garbage day); `'weekly:1:1,4'`
   *   is every Monday and Thursday. Weeks are counted from `activeFrom`,
   *   Sunday-aligned, so "every other week" means relative to when the
   *   habit was created, not some global epoch.
   * - `'monthly:<N>:<day>'` — every `N` months, on the given day of the
   *   month (1–31). `'monthly:1:1'` is the 1st of every month;
   *   `'monthly:3:15'` is quarterly, on the 15th. A day past the end of a
   *   shorter month (e.g. 31 in February) is simply skipped that month
   *   rather than rolling over — silently moving a due date is worse than
   *   missing it once.
   */
  cadence: string
  activeFrom: DayKey
  /** Absent means still running. */
  activeTo?: DayKey
  sort: number
}

const WEEKLY_PATTERN = /^weekly:(\d+):([0-6](?:,[0-6])*)$/
const MONTHLY_PATTERN = /^monthly:(\d+):(\d{1,2})$/

/** The Sunday that starts `date`'s week, at local midnight. */
function startOfWeek(date: Date): Date {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  start.setHours(0, 0, 0, 0)
  return start
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

function weeksBetween(from: Date, to: Date): number {
  return Math.round((startOfWeek(to).getTime() - startOfWeek(from).getTime()) / MS_PER_WEEK)
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

function appliesOnDay(cadence: string, day: DayKey, activeFrom: DayKey): boolean {
  if (cadence === 'daily') return true
  if (cadence === 'weekdays') {
    const weekday = parseDayKey(day).getDay()
    return weekday >= 1 && weekday <= 5
  }

  const weekly = WEEKLY_PATTERN.exec(cadence)
  if (weekly) {
    const interval = Math.max(1, Number(weekly[1]))
    const weekdays = weekly[2].split(',').map(Number)
    const date = parseDayKey(day)
    if (!weekdays.includes(date.getDay())) return false
    const elapsed = weeksBetween(parseDayKey(activeFrom), date)
    return elapsed >= 0 && elapsed % interval === 0
  }

  const monthly = MONTHLY_PATTERN.exec(cadence)
  if (monthly) {
    const interval = Math.max(1, Number(monthly[1]))
    const dayOfMonth = Number(monthly[2])
    const date = parseDayKey(day)
    if (date.getDate() !== dayOfMonth) return false
    const elapsed = monthsBetween(parseDayKey(activeFrom), date)
    return elapsed >= 0 && elapsed % interval === 0
  }

  return false
}

/** Builds a `weekly:` cadence string from a UI picker's interval + day selection. */
export function weeklyCadence(interval: number, weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  return `weekly:${Math.max(1, Math.round(interval))}:${days.join(',')}`
}

/** Builds a `monthly:` cadence string — `interval: 3` is the quarterly case. */
export function monthlyCadence(interval: number, dayOfMonth: number): string {
  const day = Math.min(31, Math.max(1, Math.round(dayOfMonth)))
  return `monthly:${Math.max(1, Math.round(interval))}:${day}`
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
    .filter((h) => appliesOnDay(h.cadence, day, h.activeFrom))
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
