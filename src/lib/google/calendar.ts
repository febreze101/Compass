/**
 * Google Calendar reads.
 *
 * Compass asks Calendar for one local day at a time. That keeps responses small
 * and lets the Today page stay responsive while the user moves between days.
 */

import { dayRange, type DayKey } from '../date'
import type { GoogleClient } from './client'
import { normalizeCalendar, normalizeEvent } from './normalize'
import { collectPages } from './paginate'
import type { Calendar, CalendarEvent, RawGoogleCalendarListEntry, RawGoogleEvent } from './types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

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
