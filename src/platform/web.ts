/**
 * Browser implementation of the platform seam — development only.
 *
 * Not a shipping target: it keeps the refresh token in `localStorage` and notes
 * in the same, neither of which is acceptable for a real install. It exists so
 * the whole app can be exercised against live Google data with an instant
 * reload loop, before either native shell is built.
 */

import { GOOGLE_DESKTOP_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_SECRET, OAUTH_CALLBACK_PATH } from '../config'
import type { ClientCredentials } from '../lib/google/auth'
import type { NoteStore, PendingAuth, Platform, SecretStore } from './types'

const SECRET_PREFIX = 'compass.secret.'
const NOTE_PREFIX = 'compass.note.'
const PENDING_KEY = 'compass.pendingAuth'

const webSecrets: SecretStore = {
  async get(key) {
    return localStorage.getItem(SECRET_PREFIX + key)
  },
  async set(key, value) {
    localStorage.setItem(SECRET_PREFIX + key, value)
  },
  async delete(key) {
    localStorage.removeItem(SECRET_PREFIX + key)
  },
}

const webNotes: NoteStore = {
  async read(dayKey) {
    return localStorage.getItem(NOTE_PREFIX + dayKey) ?? ''
  },
  async write(dayKey, markdown) {
    if (markdown.trim()) localStorage.setItem(NOTE_PREFIX + dayKey, markdown)
    else localStorage.removeItem(NOTE_PREFIX + dayKey)
  },
  async listDaysWithNotes() {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(NOTE_PREFIX))
      .map((key) => key.slice(NOTE_PREFIX.length))
      .sort()
  },
}

/**
 * Consumed at module load, before React can render and rewrite the URL.
 *
 * Reading it once here also means a page reload can't replay a spent
 * authorization code, which Google rejects with `invalid_grant`.
 */
const bootRedirect: string | null = (() => {
  if (typeof window === 'undefined') return null
  const { pathname, search } = window.location
  if (pathname !== OAUTH_CALLBACK_PATH) return null
  if (!search.includes('code=') && !search.includes('error=')) return null
  const url = window.location.href
  window.history.replaceState({}, '', '/')
  return url
})()

let consumed = false

export function createWebPlatform(): Platform {
  return {
    name: 'web',
    secrets: webSecrets,
    notes: webNotes,
    oauth: {
      async redirectUri() {
        // Google's loopback rule accepts any port on 127.0.0.1, but *not*
        // `localhost` for newer desktop clients — so the dev server must be
        // opened as http://127.0.0.1:5173, not http://localhost:5173.
        return `${window.location.origin}${OAUTH_CALLBACK_PATH}`
      },

      credentials(): ClientCredentials {
        return {
          clientId: GOOGLE_DESKTOP_CLIENT_ID,
          clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET || undefined,
        }
      },

      async authorize(authUrl) {
        window.location.assign(authUrl)
        // The page is unloading; nothing after this runs. The flow resumes at
        // `consumeRedirect()` on the next boot.
        return new Promise<string>(() => {})
      },

      async savePending(pending) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
      },

      async takePending(): Promise<PendingAuth | null> {
        const raw = sessionStorage.getItem(PENDING_KEY)
        sessionStorage.removeItem(PENDING_KEY)
        if (!raw) return null
        try {
          return JSON.parse(raw) as PendingAuth
        } catch {
          return null
        }
      },

      consumeRedirect() {
        if (consumed) return null
        consumed = true
        return bootRedirect
      },
    },
  }
}
