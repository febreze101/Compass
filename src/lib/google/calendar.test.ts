import { describe, expect, it, vi } from 'vitest'
import { listCalendars, listEvents } from './calendar'
import type { GoogleClient } from './client'

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
