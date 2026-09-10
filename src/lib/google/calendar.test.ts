import { describe, expect, it, vi } from 'vitest'
import {
  createEvent,
  defaultWriteCalendar,
  deleteEvent,
  draftFromEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from './calendar'
import type { GoogleClient } from './client'
import type { Calendar, CalendarEvent } from './types'

function clientReturning(...pages: unknown[]): GoogleClient & { urls: string[] } {
  const urls: string[] = []
  let call = 0
  return {
    urls,
    request: vi.fn(async (url: string) => {
      urls.push(url)
      return pages[Math.min(call++, pages.length - 1)]
    }),
  } as unknown as GoogleClient & { urls: string[] }
}

describe('listCalendars', () => {
  it('normalizes the calendar list', async () => {
    const client = clientReturning({
      items: [
        {
          id: 'primary@x',
          summary: 'Fabrice',
          primary: true,
          backgroundColor: '#039be5',
          accessRole: 'owner',
        },
        { id: 'holidays', summary: 'Holidays in United States', accessRole: 'reader' },
      ],
    })
    const calendars = await listCalendars(client)

    expect(calendars).toHaveLength(2)
    expect(calendars[0]).toMatchObject({
      id: 'primary@x',
      title: 'Fabrice',
      primary: true,
      readOnly: false,
    })
    expect(calendars[1]).toMatchObject({ id: 'holidays', primary: false, readOnly: true })
  })

  it('follows pagination', async () => {
    const client = clientReturning({ items: [{ id: 'a' }], nextPageToken: 'p2' }, { items: [{ id: 'b' }] })
    expect(await listCalendars(client)).toHaveLength(2)
    expect(client.urls[1]).toContain('pageToken=p2')
  })
})

describe('listEvents', () => {
  const page = {
    items: [
      {
        id: 'e1',
        summary: 'Standup',
        status: 'confirmed',
        start: { dateTime: '2026-09-05T09:30:00-07:00' },
        end: { dateTime: '2026-09-05T09:45:00-07:00' },
      },
    ],
  }

  it('queries a single local day, expanding recurrence', async () => {
    const client = clientReturning(page)
    await listEvents(client, { calendarId: 'cal-a', day: '2026-09-05' })

    const url = new URL(client.urls[0])
    expect(url.pathname).toContain('/calendars/cal-a/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('orderBy')).toBe('startTime')
    expect(url.searchParams.get('timeMin')).toMatch(/^2026-09-05T00:00:00/)
    expect(url.searchParams.get('timeMax')).toMatch(/^2026-09-06T00:00:00/)
  })

  it('url-encodes calendar ids containing @ and #', async () => {
    const client = clientReturning(page)
    await listEvents(client, {
      calendarId: 'en.usa#holiday@group.v.calendar.google.com',
      day: '2026-09-05',
    })
    expect(client.urls[0]).toContain('en.usa%23holiday%40group.v.calendar.google.com')
  })

  it('tags each event with the calendar it came from', async () => {
    const client = clientReturning(page)
    const [event] = await listEvents(client, { calendarId: 'cal-a', day: '2026-09-05' })
    expect(event.calendarId).toBe('cal-a')
    expect(event.title).toBe('Standup')
  })

  it('drops cancelled events', async () => {
    const client = clientReturning({
      items: [{ ...page.items[0], id: 'gone', status: 'cancelled' }, page.items[0]],
    })
    const events = await listEvents(client, { calendarId: 'cal-a', day: '2026-09-05' })
    expect(events.map((e) => e.id)).toEqual(['e1'])
  })

  it('returns an empty list when the day has nothing', async () => {
    expect(await listEvents(clientReturning({}), { calendarId: 'c', day: '2026-09-05' })).toEqual([])
  })
})

// ── Writes ───────────────────────────────────────────────────────────────────

/** Records the request init as well as the URL, which the writes depend on. */
function writeClient(reply: unknown = {
  id: 'new',
  summary: 'x',
  start: { dateTime: '2026-09-05T09:00:00-07:00' },
  end: { dateTime: '2026-09-05T10:00:00-07:00' },
}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const client = {
    calls,
    request: vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return reply
    }),
  }
  return client as unknown as GoogleClient & typeof client
}

const bodyOf = (init?: RequestInit) => JSON.parse(init?.body as string) as Record<string, never>

describe('createEvent', () => {
  it('posts a timed event with a real UTC offset', async () => {
    const client = writeClient()
    await createEvent(client, {
      calendarId: 'cal-a',
      draft: { title: 'Dentist', day: '2026-09-05', startTime: '15:00', endTime: '16:00' },
    })

    const { url, init } = client.calls[0]
    expect(url).toContain('/calendars/cal-a/events')
    expect(init?.method).toBe('POST')
    const body = bodyOf(init)
    expect(body.summary).toBe('Dentist')
    expect(body.start).toEqual({ dateTime: expect.stringMatching(/^2026-09-05T15:00:00[+-]\d\d:\d\d$/) })
    expect(body.end).toEqual({ dateTime: expect.stringMatching(/^2026-09-05T16:00:00[+-]\d\d:\d\d$/) })
  })

  it('gives an event with no end a one-hour default', async () => {
    const client = writeClient()
    await createEvent(client, {
      calendarId: 'c',
      draft: { title: 'Standup', day: '2026-09-05', startTime: '09:30' },
    })
    expect(bodyOf(client.calls[0].init).end).toEqual({
      dateTime: expect.stringMatching(/^2026-09-05T10:30:00/),
    })
  })

  it('writes an all-day event with an exclusive end date', async () => {
    // Google's all-day end is the *next* day. Sending the same date produces a
    // zero-length event that renders nowhere.
    const client = writeClient()
    await createEvent(client, {
      calendarId: 'c',
      draft: { title: 'Holiday', day: '2026-09-05' },
    })
    const body = bodyOf(client.calls[0].init)
    expect(body.start).toEqual({ date: '2026-09-05' })
    expect(body.end).toEqual({ date: '2026-09-06' })
  })

  it('crosses a month boundary on an all-day event', async () => {
    const client = writeClient()
    await createEvent(client, { calendarId: 'c', draft: { title: 'x', day: '2026-09-30' } })
    expect(bodyOf(client.calls[0].init).end).toEqual({ date: '2026-10-01' })
  })

  it('refuses an end at or before its start', async () => {
    const client = writeClient()
    const draft = { title: 'x', day: '2026-09-05', startTime: '15:00', endTime: '14:00' }
    await expect(createEvent(client, { calendarId: 'c', draft })).rejects.toThrow(/end after/i)
    await expect(
      createEvent(client, { calendarId: 'c', draft: { ...draft, endTime: '15:00' } }),
    ).rejects.toThrow(/end after/i)
    expect(client.calls).toHaveLength(0)
  })

  it('refuses an empty title', async () => {
    const client = writeClient()
    await expect(
      createEvent(client, { calendarId: 'c', draft: { title: '  ', day: '2026-09-05' } }),
    ).rejects.toThrow(/title/i)
  })

  it('url-encodes the calendar id', async () => {
    const client = writeClient()
    await createEvent(client, {
      calendarId: 'a@group.calendar.google.com',
      draft: { title: 'x', day: '2026-09-05' },
    })
    expect(client.calls[0].url).toContain('a%40group.calendar.google.com')
  })
})

describe('updateEvent', () => {
  it('patches rather than replaces, so unmodelled fields survive', async () => {
    // Compass models four fields of an event. A PUT would drop the rest —
    // guests, meeting links, reminders.
    const client = writeClient()
    await updateEvent(client, {
      calendarId: 'cal-a',
      eventId: 'evt-1',
      draft: { title: 'Renamed', day: '2026-09-05', startTime: '09:00' },
    })
    expect(client.calls[0].init?.method).toBe('PATCH')
    expect(client.calls[0].url).toContain('/calendars/cal-a/events/evt-1')
  })

  it('sends an empty location so clearing one actually clears it', async () => {
    // An omitted field keeps its old value under PATCH semantics.
    const client = writeClient()
    await updateEvent(client, {
      calendarId: 'c',
      eventId: 'e',
      draft: { title: 'x', day: '2026-09-05', location: '' },
    })
    expect(bodyOf(client.calls[0].init).location).toBe('')
  })

  it('url-encodes a recurring instance id', async () => {
    const client = writeClient()
    await updateEvent(client, {
      calendarId: 'c',
      eventId: 'abc_20260905T163000Z',
      draft: { title: 'x', day: '2026-09-05' },
    })
    expect(client.calls[0].url).toContain('/events/abc_20260905T163000Z')
  })
})

describe('deleteEvent', () => {
  it('deletes by calendar and event id', async () => {
    const client = writeClient(undefined)
    await deleteEvent(client, { calendarId: 'cal-a', eventId: 'evt-1' })
    expect(client.calls[0].init?.method).toBe('DELETE')
    expect(client.calls[0].url).toContain('/calendars/cal-a/events/evt-1')
  })
})

describe('draftFromEvent', () => {
  const base: CalendarEvent = {
    id: 'e',
    calendarId: 'c',
    title: 'Standup',
    start: new Date(2026, 8, 5, 9, 30),
    end: new Date(2026, 8, 5, 9, 45),
    allDay: false,
    status: 'confirmed',
    recurring: false,
  }

  it('fills times from a timed event', () => {
    expect(draftFromEvent(base)).toMatchObject({
      title: 'Standup',
      day: '2026-09-05',
      startTime: '09:30',
      endTime: '09:45',
    })
  })

  it('leaves times blank for an all-day event', () => {
    const draft = draftFromEvent({
      ...base,
      allDay: true,
      start: new Date(2026, 8, 5),
      end: new Date(2026, 8, 6),
    })
    expect(draft.startTime).toBeUndefined()
    expect(draft.endTime).toBeUndefined()
    expect(draft.day).toBe('2026-09-05')
  })

  it('survives a save on an event that crosses midnight', async () => {
    // 23:00–01:00 lands its end on the next day. Collapsing that onto one day
    // would make the end precede the start and the save would be refused.
    const client = writeClient()
    const draft = draftFromEvent({
      ...base,
      start: new Date(2026, 8, 5, 23, 0),
      end: new Date(2026, 8, 6, 1, 0),
    })
    expect(draft).toMatchObject({ day: '2026-09-05', startTime: '23:00', endTime: '01:00' })

    await createEvent(client, { calendarId: 'c', draft })
    expect(bodyOf(client.calls[0].init).end).toEqual({
      dateTime: expect.stringMatching(/^2026-09-06T01:00:00/),
    })
  })

  it('keeps the length of a multi-day all-day event', async () => {
    // A three-day all-day event ends at midnight on the fourth. Defaulting to
    // day+1 would quietly shorten it to one day.
    const client = writeClient()
    const draft = draftFromEvent({
      ...base,
      allDay: true,
      start: new Date(2026, 8, 5),
      end: new Date(2026, 8, 8),
    })
    await createEvent(client, { calendarId: 'c', draft })
    expect(bodyOf(client.calls[0].init)).toMatchObject({
      start: { date: '2026-09-05' },
      end: { date: '2026-09-08' },
    })
  })

  it('re-dates the end when a timed event is turned into an all-day one', async () => {
    // The carried endDay still names the day the timed event finished on;
    // reusing it verbatim would produce a zero-length all-day event.
    const client = writeClient()
    const draft = draftFromEvent(base)
    await createEvent(client, {
      calendarId: 'c',
      draft: { ...draft, startTime: undefined, endTime: undefined },
    })
    expect(bodyOf(client.calls[0].init)).toMatchObject({
      start: { date: '2026-09-05' },
      end: { date: '2026-09-06' },
    })
  })

  it('round-trips an all-day event back to the same exclusive end', async () => {
    const client = writeClient()
    const draft = draftFromEvent({
      ...base,
      allDay: true,
      start: new Date(2026, 8, 5),
      end: new Date(2026, 8, 6),
    })
    await createEvent(client, { calendarId: 'c', draft })
    expect(bodyOf(client.calls[0].init).end).toEqual({ date: '2026-09-06' })
  })
})

describe('defaultWriteCalendar', () => {
  const calendars: Calendar[] = [
    { id: 'holidays', title: 'US Holidays', primary: false, readOnly: true },
    { id: 'other', title: 'Side', primary: false, readOnly: false },
    { id: 'me', title: 'Fabrice', primary: true, readOnly: false },
  ]

  it('prefers the primary calendar', () => {
    expect(defaultWriteCalendar(calendars, ['holidays', 'other', 'me'])?.id).toBe('me')
  })

  it('falls back to the first writable selected calendar', () => {
    expect(defaultWriteCalendar(calendars, ['holidays', 'other'])?.id).toBe('other')
  })

  it('never picks a read-only calendar', () => {
    // Google rejects writes to subscribed feeds; offering one guarantees a
    // failure the user cannot act on.
    expect(defaultWriteCalendar(calendars, ['holidays'])).toBeUndefined()
  })

  it('ignores writable calendars the user has turned off', () => {
    expect(defaultWriteCalendar(calendars, [])).toBeUndefined()
  })
})
