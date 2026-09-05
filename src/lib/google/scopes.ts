/**
 * Checks what the user actually granted against what Compass needs.
 *
 * Google's consent screen lets a user approve some sensitive scopes and decline
 * others. The resulting token is perfectly valid — it just 403s with
 * "Request had insufficient authentication scopes" on the endpoints it wasn't
 * granted for. Catching that here turns an opaque API error into a sentence
 * that says which permission is missing and what to do about it.
 */

const EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const CALENDAR_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const TASKS = 'https://www.googleapis.com/auth/tasks'

/**
 * What each capability needs, as a list of scopes any *one* of which suffices.
 *
 * Listing alternatives matters: a user who granted full `calendar` access has
 * more than enough to list calendars, and insisting on the narrow scope by name
 * would report a problem that isn't there.
 */
const REQUIREMENTS: { canonical: string; accepts: string[] }[] = [
  { canonical: EVENTS, accepts: [EVENTS, 'https://www.googleapis.com/auth/calendar'] },
  {
    canonical: CALENDAR_LIST,
    accepts: [
      CALENDAR_LIST,
      'https://www.googleapis.com/auth/calendar.calendarlist',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar',
    ],
  },
  { canonical: TASKS, accepts: [TASKS] },
]

/** Human-facing name for each scope, so errors can talk about features. */
const FEATURE_BY_SCOPE: Record<string, string> = {
  [EVENTS]: 'your calendar events',
  [CALENDAR_LIST]: 'the list of your calendars',
  [TASKS]: 'your tasks',
}

/**
 * Required scopes absent from a grant.
 *
 * An absent `granted` means "unknown", not "nothing" — blocking a working
 * session on missing metadata would be a false alarm.
 */
export function missingScopes(granted: string | undefined): string[] {
  if (granted === undefined) return []
  const held = new Set(granted.split(/\s+/).filter(Boolean))
  return REQUIREMENTS.filter((need) => !need.accepts.some((scope) => held.has(scope))).map(
    (need) => need.canonical,
  )
}

export function describeMissingScopes(missing: string[]): string {
  if (missing.length === 0) return ''
  const features = missing.map((scope) => FEATURE_BY_SCOPE[scope] ?? scope)
  return (
    `Google did not grant access to ${features.join(' and ')}. ` +
    'Disconnect and sign in again, making sure every permission stays ticked on the ' +
    'consent screen. If it keeps happening, remove Compass at ' +
    'myaccount.google.com/permissions first, then reconnect.'
  )
}
