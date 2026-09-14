/**
 * Picks the platform implementation for whatever shell the app is running in.
 *
 * Tauri and Capacitor both inject globals into the page, so detection is a
 * property check rather than a build flag — one bundle runs everywhere.
 */

import { createSyncedNoteStore, type SyncedNoteStore } from '../lib/notesSync'
import { supabase } from '../lib/supabase'
import { createCapacitorPlatform } from './capacitor'
import { createTauriPlatform } from './tauri'
import { createWebPlatform } from './web'
import type { DayKey } from '../lib/date'
import type { Platform, PlatformName } from './types'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

export function detectPlatform(): PlatformName {
  if (typeof window === 'undefined') return 'web'
  if (window.__TAURI_INTERNALS__) return 'tauri'
  if (window.Capacitor?.isNativePlatform?.()) return 'capacitor'
  return 'web'
}

let current: Platform | null = null
let syncedNotes: SyncedNoteStore | null = null

/**
 * The active platform, created once per session.
 *
 * When a Supabase project is configured, `notes` is swapped for the synced
 * decorator (docs/UPDATES.md §1.3) right here — every other module keeps
 * calling `platform().notes.read/write/listDaysWithNotes` exactly as before
 * and stays unaware sync exists. `pullNote` below is the one addition, for
 * the pull points that have to live outside this seam.
 */
export function platform(): Platform {
  if (current) return current
  switch (detectPlatform()) {
    case 'tauri':
      current = createTauriPlatform()
      break
    case 'capacitor':
      current = createCapacitorPlatform()
      break
    case 'web':
    default:
      current = createWebPlatform()
  }
  const client = supabase()
  if (client) {
    syncedNotes = createSyncedNoteStore(current.notes, client)
    current.notes = syncedNotes
  }
  return current
}

/**
 * Reconciles one day's note against Supabase. A no-op when sync isn't
 * configured (`.env.local` missing the Supabase vars) — sync is additive,
 * never a requirement for the app to work. Call `platform()` first so the
 * decorator exists.
 */
export function pullNote(day: DayKey): Promise<void> {
  return syncedNotes ? syncedNotes.pull(day) : Promise.resolve()
}

export type { Platform } from './types'
