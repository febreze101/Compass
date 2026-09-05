/**
 * Google's wire shapes (`Raw*`) and Compass's domain models.
 *
 * The raw types cover only the fields Compass reads — Google returns far more.
 * Keeping them separate from the domain models means Google's quirks (exclusive
 * end dates, UTC-midnight due dates, optional summaries) get resolved once, in
 * `normalize.ts`, instead of leaking into components.
 */

import type { DayKey } from '../date'

// ── Google Calendar ──────────────────────────────────────────────────────────

export interface RawGoogleEventDate {
  /** Present for timed events; RFC3339 with offset. */
  dateTime?: string
  /** Present for all-day events; `YYYY-MM-DD`. Exclusive when it's the end. */
  date?: string
  timeZone?: string
}

export interface RawGoogleEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  status?: string
  htmlLink?: string
  start: RawGoogleEventDate
  end: RawGoogleEventDate
}

export interface RawGoogleCalendarListEntry {
  id: string
  summary?: string
  primary?: boolean
  backgroundColor?: string
  foregroundColor?: string
  selected?: boolean
  accessRole?: string
}

// ── Google Tasks ─────────────────────────────────────────────────────────────

export interface RawGoogleTask {
  id: string
  title?: string
  notes?: string
  status?: string
  /** UTC-midnight RFC3339. The time component is meaningless — see docs/SCOPE.md §7. */
  due?: string
  position?: string
  parent?: string
  completed?: string
}

export interface RawGoogleTaskList {
  id: string
  title?: string
}

// ── Domain models ────────────────────────────────────────────────────────────

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  /** Local instant the event starts. For all-day events, local midnight. */
  start: Date
  /** Exclusive end, matching Google. An all-day event on the 7th ends at midnight on the 8th. */
  end: Date
  allDay: boolean
  status: EventStatus
  location?: string
  description?: string
  htmlLink?: string
}

export interface Calendar {
  id: string
  title: string
  primary: boolean
  backgroundColor?: string
  foregroundColor?: string
  /** Whether Compass shows this calendar — the user's choice, stored locally. */
  readOnly: boolean
}

export interface TaskItem {
  id: string
  listId: string
  title: string
  notes?: string
  /** Due *day*. Google exposes no time — see docs/SCOPE.md §7. */
  due?: DayKey
  completed: boolean
  position: string
  parent?: string
}

export interface TaskList {
  id: string
  title: string
}
