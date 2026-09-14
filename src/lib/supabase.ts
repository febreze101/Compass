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
      // Compass already persists the session itself, keyed to the platform's
      // own secret store (see session.ts) — a second copy in localStorage
      // would be one more place for the two to drift.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return client
}
