/**
 * Picks the platform implementation for whatever shell the app is running in.
 *
 * Tauri and Capacitor both inject globals into the page, so detection is a
 * property check rather than a build flag — one bundle runs everywhere.
 */

import { createTauriPlatform } from './tauri'
import { createWebPlatform } from './web'
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

/** The active platform, created once per session. */
export function platform(): Platform {
  if (current) return current
  switch (detectPlatform()) {
    case 'tauri':
      current = createTauriPlatform()
      break
    // The Android shell lands at M5; until then it falls back to the browser
    // implementation, which is wrong for storage but lets the UI run.
    case 'capacitor':
    case 'web':
    default:
      current = createWebPlatform()
  }
  return current
}

export type { Platform } from './types'
