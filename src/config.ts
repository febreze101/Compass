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
 * `calendar.events` and `tasks` are both read/write — v1 creates and edits on
 * both sides. `userinfo.email` is only so the settings screen can show which
 * account is connected.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Path segment Google redirects back to, on every platform. */
export const OAUTH_CALLBACK_PATH = '/oauth/callback';

/** Reverse-DNS id shared by the Tauri bundle and the Android package. */
export const APP_ID = 'app.compass.agenda';
