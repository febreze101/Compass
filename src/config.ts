/**
 * OAuth configuration.
 *
 * Compass is an "installed app": it runs on the user's machine, so it cannot
 * keep a genuine secret. Google's Desktop-app client type still issues a
 * `client_secret` and still requires it in the token exchange, but Google's own
 * documentation treats it as non-confidential for installed apps (the `gcloud`
 * CLI ships one in plain text). PKCE is what actually protects the flow.
 *
 * The Android client type takes no secret at all.
 *
 * Fill these in via `.env.local` — see `.env.example` and `docs/google-setup.md`.
 */

export const GOOGLE_DESKTOP_CLIENT_ID = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ?? '';
export const GOOGLE_DESKTOP_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET ?? '';
export const GOOGLE_ANDROID_CLIENT_ID = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID ?? '';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * The narrowest set of scopes that actually works.
 *
 * `calendar.events` covers reading and writing events, but *not* listing the
 * user's calendars — `calendarList.list` accepts only `calendar`,
 * `calendar.readonly`, `calendar.calendarlist` or
 * `calendar.calendarlist.readonly`. The read-only calendarList scope is the
 * least privilege that lets the source picker work; Compass never creates or
 * deletes calendars, only events on them.
 *
 * `userinfo.email` was requested at first and dropped: nothing in the app ever
 * called for it, and an unused scope is one more line on the consent screen for
 * the user to decline.
 *
 * `openid email` was added back for note sync (docs/UPDATES.md §1.5): the ID
 * token it produces is what lets Supabase authenticate the user via
 * `signInWithIdToken`, with no second sign-in and a real `auth.uid()` for RLS.
 * Changing the scope set means one extra consent-screen trip on next sign-in —
 * accepted per §9.3.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

/** Path segment Google redirects back to, on every platform. */
export const OAUTH_CALLBACK_PATH = '/oauth/callback';

/** Reverse-DNS id shared by the Tauri bundle and the Android package. */
export const APP_ID = 'app.compass.agenda';
