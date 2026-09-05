import { describe, expect, it } from 'vitest'
import { describeMissingScopes, missingScopes } from './scopes'

const EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const CALENDAR_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const TASKS = 'https://www.googleapis.com/auth/tasks'
const ALL = `${EVENTS} ${CALENDAR_LIST} ${TASKS}`

describe('missingScopes', () => {
  it('finds nothing missing when every scope was granted', () => {
    expect(missingScopes(ALL)).toEqual([])
  })

  it('reports a scope the user declined on the consent screen', () => {
    // Google's consent screen lets a user tick some sensitive scopes and not
    // others, which produces a token that works for calendar and 403s on tasks.
    expect(missingScopes(`${EVENTS} ${CALENDAR_LIST}`)).toContain(TASKS)
  })

  it('reports a missing calendarList scope, which calendar.events does not imply', () => {
    expect(missingScopes(`${EVENTS} ${TASKS}`)).toEqual([CALENDAR_LIST])
  })

  it('accepts the broader calendar scopes that also cover calendarList', () => {
    // A user who granted full `calendar` access has more than enough; demanding
    // the narrow scope by name would report a false problem.
    const broad = `${EVENTS} https://www.googleapis.com/auth/calendar ${TASKS}`
    expect(missingScopes(broad)).toEqual([])
  })

  it('accepts calendar.readonly in place of the calendarList scope', () => {
    const readonly = `${EVENTS} https://www.googleapis.com/auth/calendar.readonly ${TASKS}`
    expect(missingScopes(readonly)).toEqual([])
  })

  it('reports everything when the grant is empty', () => {
    expect(missingScopes('')).toEqual(expect.arrayContaining([EVENTS, CALENDAR_LIST, TASKS]))
  })

  it('treats an unknown grant as complete rather than crying wolf', () => {
    // Google has always returned `scope`, but guessing "missing" from absent
    // data would block a working session on a false alarm.
    expect(missingScopes(undefined)).toEqual([])
  })

  it('ignores extra scopes Google adds of its own accord', () => {
    expect(missingScopes(`openid ${ALL} profile`)).toEqual([])
  })

  it('tolerates irregular whitespace', () => {
    expect(missingScopes(`  ${EVENTS}   ${CALENDAR_LIST}  ${TASKS} `)).toEqual([])
  })
})

describe('describeMissingScopes', () => {
  it('names the feature that will not work, not just the URL', () => {
    const message = describeMissingScopes([TASKS])
    expect(message).toMatch(/tasks/i)
    expect(message).toMatch(/reconnect|sign in again/i)
  })

  it('describes the calendarList scope in terms the user can act on', () => {
    expect(describeMissingScopes([CALENDAR_LIST])).toMatch(/calendar list|your calendars/i)
  })

  it('is empty when nothing is missing', () => {
    expect(describeMissingScopes([])).toBe('')
  })
})
