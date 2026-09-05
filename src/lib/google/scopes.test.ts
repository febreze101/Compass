import { describe, expect, it } from 'vitest'
import { describeMissingScopes, missingScopes } from './scopes'

const CALENDAR = 'https://www.googleapis.com/auth/calendar.events'
const TASKS = 'https://www.googleapis.com/auth/tasks'

describe('missingScopes', () => {
  it('finds nothing missing when every scope was granted', () => {
    expect(missingScopes(`${CALENDAR} ${TASKS}`)).toEqual([])
  })

  it('reports a scope the user declined on the consent screen', () => {
    // Google's consent screen lets a user tick some sensitive scopes and not
    // others, which produces a token that works for calendar and 403s on tasks.
    expect(missingScopes(CALENDAR)).toContain(TASKS)
  })

  it('reports everything when the grant is empty', () => {
    expect(missingScopes('')).toEqual(expect.arrayContaining([CALENDAR, TASKS]))
  })

  it('treats an unknown grant as complete rather than crying wolf', () => {
    // Google has always returned `scope`, but guessing "missing" from absent
    // data would block a working session on a false alarm.
    expect(missingScopes(undefined)).toEqual([])
  })

  it('ignores extra scopes Google adds of its own accord', () => {
    expect(missingScopes(`openid ${CALENDAR} ${TASKS} profile`)).toEqual([])
  })

  it('tolerates irregular whitespace', () => {
    expect(missingScopes(`  ${CALENDAR}   ${TASKS}  `)).toEqual([])
  })
})

describe('describeMissingScopes', () => {
  it('names the feature that will not work, not just the URL', () => {
    const message = describeMissingScopes([TASKS])
    expect(message).toMatch(/tasks/i)
    expect(message).toMatch(/reconnect|sign in again/i)
  })

  it('is empty when nothing is missing', () => {
    expect(describeMissingScopes([])).toBe('')
  })
})
