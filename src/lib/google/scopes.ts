/**
 * Checks what the user actually granted against what Compass needs.
 *
 * Google's consent screen lets a user approve some sensitive scopes and decline
 * others. The resulting token is perfectly valid — it just 403s with
 * "Request had insufficient authentication scopes" on the endpoints it wasn't
 * granted for. Catching that here turns an opaque API error into a sentence
 * that says which permission is missing and what to do about it.
 */

/**
 * Only the scopes the app genuinely cannot work without.
 *
 * `userinfo.email` is requested too, but it only labels the settings panel —
 * failing a session over it would be a false alarm.
 */
const REQUIRED = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
]

/** Human-facing name for each scope, so errors can talk about features. */
const FEATURE_BY_SCOPE: Record<string, string> = {
  'https://www.googleapis.com/auth/calendar.events': 'Calendar events',
  'https://www.googleapis.com/auth/tasks': 'Tasks',
  'https://www.googleapis.com/auth/userinfo.email': 'your account email',
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
  return REQUIRED.filter((scope) => !held.has(scope))
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
