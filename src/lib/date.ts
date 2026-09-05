/**
 * Day handling for Compass.
 *
 * Everything the user sees is anchored to a *local* calendar day, not an
 * instant: "today" means the day on the wall clock in front of them. So the
 * canonical identifier for a day is a `YYYY-MM-DD` string in local time, and
 * conversions to instants (for API queries) happen at the edges.
 *
 * Deliberately hand-rolled rather than pulled from date-fns: these are a dozen
 * lines, and keeping them dependency-free makes the timezone behaviour explicit
 * and easy to audit.
 */

/** A local calendar day, `YYYY-MM-DD`. */
export type DayKey = string

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number): string => String(n).padStart(2, '0')

/** Formats a `Date` as the local day it falls on. */
export function dayKeyOf(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The current local day. */
export function todayKey(): DayKey {
  return dayKeyOf(new Date())
}

/**
 * Local midnight at the start of `key`.
 *
 * Throws on anything that isn't a real calendar day — including well-formed but
 * non-existent dates like `2026-02-29`, which `new Date()` would silently roll
 * forward to March 1st.
 */
export function parseDayKey(key: string): Date {
  if (!DAY_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid day key ${JSON.stringify(key)}: expected YYYY-MM-DD`)
  }
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid day key ${JSON.stringify(key)}: no such date`)
  }
  return date
}

/** Shifts a day key by whole days, crossing month and year boundaries correctly. */
export function addDays(key: DayKey, delta: number): DayKey {
  const date = parseDayKey(key)
  date.setDate(date.getDate() + delta)
  return dayKeyOf(date)
}

/** True when `date` falls on the local day `key`. */
export function isSameDayKey(date: Date, key: DayKey): boolean {
  return dayKeyOf(date) === key
}

/** `+05:30`-style UTC offset for an instant, as RFC3339 requires. */
function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** RFC3339 timestamp with a real offset, which is what the Calendar API wants. */
export function toRfc3339(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    utcOffset(date)
  )
}

/**
 * The half-open instant range covering a local day, for Calendar's
 * `timeMin`/`timeMax`. `timeMax` is the *start* of the following day, matching
 * Google's exclusive upper bound.
 */
export function dayRange(key: DayKey): { timeMin: string; timeMax: string } {
  const start = parseDayKey(key)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { timeMin: toRfc3339(start), timeMax: toRfc3339(end) }
}
