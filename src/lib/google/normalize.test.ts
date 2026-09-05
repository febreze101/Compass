import { describe, expect, it } from 'vitest'
import { normalizeEvent, normalizeTask } from './normalize'
import type { RawGoogleEvent, RawGoogleTask } from './types'

const timed: RawGoogleEvent = {
  id: 'evt1',
  summary: 'Standup',
  status: 'confirmed',
  start: { dateTime: '2026-09-05T09:30:00-07:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-09-05T09:45:00-07:00', timeZone: 'America/Los_Angeles' },
  location: 'Zoom',
  htmlLink: 'https://calendar.google.com/x',
}

const allDay: RawGoogleEvent = {
  id: 'evt2',
  summary: 'Labor Day',
  status: 'confirmed',
  start: { date: '2026-09-07' },
  end: { date: '2026-09-08' }, // Google's end is exclusive
}

describe('normalizeEvent', () => {
  it('reads a timed event', () => {
    const e = normalizeEvent(timed, 'cal-a')
    expect(e.id).toBe('evt1')
    expect(e.calendarId).toBe('cal-a')
    expect(e.title).toBe('Standup')
    expect(e.allDay).toBe(false)
    expect(e.location).toBe('Zoom')
    expect(e.start.toISOString()).toBe('2026-09-05T16:30:00.000Z')
    expect(e.end.toISOString()).toBe('2026-09-05T16:45:00.000Z')
  })

  it('anchors an all-day event to LOCAL midnight, not UTC midnight', () => {
    // `new Date('2026-09-07')` parses as UTC and lands on the 6th in any
    // timezone behind UTC — which is where the user actually is.
    const e = normalizeEvent(allDay, 'cal-b')
    expect(e.allDay).toBe(true)
    expect(e.start.getFullYear()).toBe(2026)
    expect(e.start.getMonth()).toBe(8)
    expect(e.start.getDate()).toBe(7)
    expect(e.start.getHours()).toBe(0)
  })

  it('keeps Google’s exclusive end for all-day events', () => {
    const e = normalizeEvent(allDay, 'cal-b')
    expect(e.end.getDate()).toBe(8)
    expect(e.end.getHours()).toBe(0)
  })

  it('falls back to a placeholder when an event has no summary', () => {
    const e = normalizeEvent({ ...timed, summary: undefined }, 'cal-a')
    expect(e.title).toBe('(No title)')
  })

  it('carries status through so cancelled events can be filtered', () => {
    expect(normalizeEvent({ ...timed, status: 'cancelled' }, 'cal-a').status).toBe('cancelled')
  })

  it('throws when an event has neither dateTime nor date', () => {
    expect(() => normalizeEvent({ ...timed, start: {} }, 'cal-a')).toThrow()
  })
})

const task: RawGoogleTask = {
  id: 'tsk1',
  title: 'Renew passport',
  status: 'needsAction',
  position: '00000000000000000000',
  due: '2026-09-05T00:00:00.000Z',
  notes: 'bring photos',
}

describe('normalizeTask', () => {
  it('reads a task', () => {
    const t = normalizeTask(task, 'list-a')
    expect(t.id).toBe('tsk1')
    expect(t.listId).toBe('list-a')
    expect(t.title).toBe('Renew passport')
    expect(t.notes).toBe('bring photos')
    expect(t.completed).toBe(false)
  })

  it('takes the due day from the string, never from local-time conversion', () => {
    // Google sends UTC midnight. Converting through a Date would yield the 4th
    // for anyone behind UTC — the user is in America/Los_Angeles.
    expect(normalizeTask(task, 'list-a').due).toBe('2026-09-05')
  })

  it('leaves due undefined when Google omits it', () => {
    expect(normalizeTask({ ...task, due: undefined }, 'list-a').due).toBeUndefined()
  })

  it('maps status to a boolean', () => {
    expect(normalizeTask({ ...task, status: 'completed' }, 'list-a').completed).toBe(true)
  })

  it('tolerates a missing title', () => {
    expect(normalizeTask({ ...task, title: undefined }, 'list-a').title).toBe('(No title)')
  })
})
