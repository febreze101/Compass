/**
 * Google wire shapes → Compass domain models.
 *
 * Two timezone traps live here, both of which produce off-by-one-day bugs for
 * anyone behind UTC (the user is in America/Los_Angeles):
 *
 *  1. All-day events arrive as `YYYY-MM-DD`. `new Date('2026-09-07')` parses
 *     that as *UTC* midnight, which is the 6th at 5pm locally.
 *  2. Task due dates arrive as UTC-midnight timestamps. Reading the day back
 *     out through local-time accessors shifts it a day earlier.
 *
 * Both are fixed by treating the date as text, never routing it through an
 * instant.
 */

import { parseDayKey, type DayKey } from '../date'
import type {
  Calendar,
  CalendarEvent,
  EventStatus,
  RawGoogleCalendarListEntry,
  RawGoogleEvent,
  RawGoogleTask,
  RawGoogleTaskList,
  TaskItem,
  TaskList,
} from './types'

const NO_TITLE = '(No title)'

function toEventStatus(status: string | undefined): EventStatus {
  return status === 'cancelled' || status === 'tentative' ? status : 'confirmed'
}

/** Resolves either half of an event's time range to a local instant. */
function resolveEventInstant(
  edge: RawGoogleEvent['start'],
  which: 'start' | 'end',
  eventId: string,
): { at: Date; allDay: boolean } {
  if (edge.dateTime) {
    return { at: new Date(edge.dateTime), allDay: false }
  }
  if (edge.date) {
    // Trap 1: parse as a local calendar day, not as a UTC instant.
    return { at: parseDayKey(edge.date), allDay: true }
  }
  throw new Error(`Event ${eventId} has no ${which} dateTime or date`)
}

export function normalizeEvent(raw: RawGoogleEvent, calendarId: string): CalendarEvent {
  const start = resolveEventInstant(raw.start, 'start', raw.id)
  const end = resolveEventInstant(raw.end, 'end', raw.id)
  return {
    id: raw.id,
    calendarId,
    title: raw.summary?.trim() || NO_TITLE,
    start: start.at,
    end: end.at,
    allDay: start.allDay,
    status: toEventStatus(raw.status),
    location: raw.location,
    description: raw.description,
    htmlLink: raw.htmlLink,
    recurring: Boolean(raw.recurringEventId),
  }
}

export function normalizeCalendar(raw: RawGoogleCalendarListEntry): Calendar {
  return {
    id: raw.id,
    title: raw.summary?.trim() || NO_TITLE,
    primary: raw.primary === true,
    backgroundColor: raw.backgroundColor,
    foregroundColor: raw.foregroundColor,
    readOnly: raw.accessRole === 'reader' || raw.accessRole === 'freeBusyReader',
  }
}

/**
 * Trap 2: slice the day out of the timestamp rather than converting it. Google
 * documents the time component as meaningless, so there is nothing to lose.
 */
function dueDay(due: string | undefined): DayKey | undefined {
  if (!due) return undefined
  const day = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined
}

export function normalizeTask(raw: RawGoogleTask, listId: string): TaskItem {
  return {
    id: raw.id,
    listId,
    title: raw.title?.trim() || NO_TITLE,
    notes: raw.notes,
    due: dueDay(raw.due),
    completed: raw.status === 'completed',
    position: raw.position ?? '',
    parent: raw.parent,
  }
}

export function normalizeTaskList(raw: RawGoogleTaskList): TaskList {
  return { id: raw.id, title: raw.title?.trim() || NO_TITLE }
}
