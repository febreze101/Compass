/**
 * The Supabase client — note sync (docs/UPDATES.md §1) and evergreen tasks
 * (§2), the two things Compass owns that aren't Google's.
 *
 * One client for the whole session, same reasoning as `state/store.ts`'s
 * single `GoogleClient`: everything downstream shares one auth state rather
 * than juggling several.
 *
 * The URL and publishable key are not secrets (see `.env.example`) — Row
 * Level Security, keyed off `auth.uid()` from the Google ID token, is what
 * actually keeps one user's rows from another's.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

let client: SupabaseClient | null = null

/**
 * `null` when `.env.local` hasn't been filled in yet — sync and evergreens
 * degrade to "not available" rather than the app failing to boot, the same
 * fallback style `android/app/build.gradle` uses for a missing client id.
 */
export function supabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Must persist and self-refresh. The Supabase session is established
      // once via the Google ID token (session.ts's syncSupabaseAuth), but
      // that ID token expires ~1 hour after sign-in and Google never
      // reissues one on a plain token refresh — so without its own
      // persisted, auto-refreshing session, every write after that first
      // hour fails RLS with "new row violates row-level security policy"
      // for no visible reason. Defaults to `localStorage`, which is real
      // and persistent in the Tauri/Capacitor webviews (unlike a raw
      // browser tab, both survive app restarts) — deliberately not routed
      // through the platform's OS-keychain SecretStore, whose blob-size
      // limit (a few KB on Windows) a full session-plus-user-metadata
      // object would risk exceeding.
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return client
}
