/**
 * Google Calendar reads.
 *
 * Compass asks Calendar for one local day at a time. That keeps responses small
 * and lets the Today page stay responsive while the user moves between days.
 */

import {
  addDays,
  atTime,
  dayKeyOf,
  dayRange,
  timeOfDay,
  toRfc3339,
  type DayKey,
  type TimeKey,
} from '../date'
import { jsonRequest, type GoogleClient } from './client'
import { normalizeCalendar, normalizeEvent } from './normalize'
import { collectPages } from './paginate'
import type {
  Calendar,
  CalendarEvent,
  RawGoogleCalendarListEntry,
  RawGoogleEvent,
  RawGoogleEventDate,
} from './types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

/** How long an event runs when given a start but no end. */
const DEFAULT_DURATION_MINUTES = 60

/** Every calendar the account can see, for the picker in settings. */
export async function listCalendars(client: GoogleClient): Promise<Calendar[]> {
  const raw = await collectPages<RawGoogleCalendarListEntry>(client, (pageToken) => {
    const query = new URLSearchParams({ maxResults: '250' })
    if (pageToken) query.set('pageToken', pageToken)
    return `${CALENDAR_API}/users/me/calendarList?${query}`
  })
  return raw.map(normalizeCalendar)
}

/**
 * Events on one calendar for one local day.
 *
 * `singleEvents=true` expands recurring series into individual instances, which
 * is the only way a day view makes sense. Cancelled instances still come back
 * (a declined or deleted occurrence of a series) and are dropped here.
 */
export async function listEvents(
  client: GoogleClient,
  params: { calendarId: string; day: DayKey },
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = dayRange(params.day)
  const path = `${CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events`

  const raw = await collectPages<RawGoogleEvent>(client, (pageToken) => {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
    if (pageToken) query.set('pageToken', pageToken)
    return `${path}?${query}`
  })

  return raw
    .map((event) => normalizeEvent(event, params.calendarId))
    .filter((event) => event.status !== 'cancelled')
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * What the user can set on an event.
 *
 * Deliberately narrower than Google's event resource: Compass edits a title, a
 * day, a time range and a location, and nothing else. Everything it doesn't
 * model — attendees, conferencing, reminders, recurrence rules — survives a
 * write untouched because updates go out as PATCH.
 */
export interface EventDraft {
  title: string
  day: DayKey
  /** `HH:MM` local. Absent makes it an all-day event. */
  startTime?: TimeKey
  /** `HH:MM` local. Absent with a `startTime` means the default duration. */
  endTime?: TimeKey
  /**
   * The local day the event *ends* on, when that isn't `day`.
   *
   * Carried but never edited: the day view has no control for it, and without
   * it an event that crosses midnight (23:00–01:00) or an all-day event that
   * spans several days would be silently truncated the first time it was
   * saved. Absent means the event ends on the day it starts.
   */
  endDay?: DayKey
  location?: string
}

/** Fills an edit form from an existing event. */
export function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    title: event.title,
    day: dayKeyOf(event.start),
    startTime: event.allDay ? undefined : timeOfDay(event.start),
    endTime: event.allDay ? undefined : timeOfDay(event.end),
    // For an all-day event `end` is already Google's exclusive next-midnight,
    // so the day it lands on is exactly what goes back on the wire.
    endDay: dayKeyOf(event.end),
    location: event.location ?? '',
  }
}

/**
 * A draft's time range in Google's shape.
 *
 * All-day events use `date` on both edges, and Google's end is *exclusive* —
 * a single day on the 7th ends on the 8th. Timed events use `dateTime` with a
 * real offset so the instant is unambiguous.
 */
function wireDates(draft: EventDraft): { start: RawGoogleEventDate; end: RawGoogleEventDate } {
  if (!draft.startTime) {
    // Day keys sort lexicographically, so this also rescues the case where a
    // timed event was just turned into an all-day one and `endDay` still names
    // the day it used to finish on.
    const lastDay =
      draft.endDay && draft.endDay > draft.day ? draft.endDay : addDays(draft.day, 1)
    return { start: { date: draft.day }, end: { date: lastDay } }
  }

  const start = atTime(draft.day, draft.startTime)
  const end = draft.endTime
    ? atTime(draft.endDay ?? draft.day, draft.endTime)
    : new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000)

  // Rejected rather than silently rolled into the next day: an end before its
  // start is a typo, and a day-anchored app has nowhere sensible to show the
  // result.
  if (end.getTime() <= start.getTime()) {
    throw new Error('An event has to end after it starts.')
  }
  return { start: { dateTime: toRfc3339(start) }, end: { dateTime: toRfc3339(end) } }
}

function eventBody(draft: EventDraft): Record<string, unknown> {
  const title = draft.title.trim()
  if (!title) throw new Error('An event needs a title.')
  return {
    summary: title,
    // Always sent, empty included: on a PATCH an omitted field keeps its old
    // value, so clearing a location needs the empty string to go out.
    location: (draft.location ?? '').trim(),
    ...wireDates(draft),
  }
}

function eventUrl(calendarId: string, eventId?: string): string {
  const base = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base
}

export async function createEvent(
  client: GoogleClient,
  params: { calendarId: string; draft: EventDraft },
): Promise<CalendarEvent> {
  const created = await client.request<RawGoogleEvent>(
    eventUrl(params.calendarId),
    jsonRequest('POST', eventBody(params.draft)),
  )
  return normalizeEvent(created, params.calendarId)
}

/**
 * Rewrites an event from a draft.
 *
 * PATCH, not PUT: Compass models a handful of an event's fields, and a PUT
 * would drop everything it doesn't send — guests, meeting links, reminders.
 *
 * For one occurrence of a repeating series, `eventId` is the expanded instance
 * id that `listEvents` returned, so the change lands on that occurrence alone
 * and leaves the series intact. Editing the series itself is out of v1 — see
 * docs/SCOPE.md §7.
 */
export async function updateEvent(
  client: GoogleClient,
  params: { calendarId: string; eventId: string; draft: EventDraft },
): Promise<CalendarEvent> {
  const updated = await client.request<RawGoogleEvent>(
    eventUrl(params.calendarId, params.eventId),
    jsonRequest('PATCH', eventBody(params.draft)),
  )
  return normalizeEvent(updated, params.calendarId)
}

/** Deletes an event, or cancels a single occurrence of a series. */
export async function deleteEvent(
  client: GoogleClient,
  params: { calendarId: string; eventId: string },
): Promise<void> {
  await client.request<void>(
    eventUrl(params.calendarId, params.eventId),
    jsonRequest('DELETE'),
  )
}

/**
 * Where a new event should go: the first selected calendar Compass may write
 * to, preferring the primary one.
 *
 * Read-only calendars (subscribed holiday feeds, other people's calendars) are
 * excluded — Google rejects writes to them, and offering the choice would only
 * produce a failure later.
 */
export function defaultWriteCalendar(
  calendars: Calendar[],
  selectedIds: string[],
): Calendar | undefined {
  const writable = calendars.filter((c) => selectedIds.includes(c.id) && !c.readOnly)
  return writable.find((c) => c.primary) ?? writable[0]
}
