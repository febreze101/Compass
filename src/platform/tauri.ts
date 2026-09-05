/**
 * Windows implementation of the platform seam, on Tauri 2.
 *
 * Differs from the browser in the two ways that matter: the refresh token lives
 * in Windows Credential Manager rather than web storage, and Google's redirect
 * is caught by a loopback HTTP server in the Rust process rather than by
 * navigating the app away.
 */

import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'

import { GOOGLE_DESKTOP_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_SECRET, OAUTH_CALLBACK_PATH } from '../config'
import type { ClientCredentials } from '../lib/google/auth'
import type { NoteStore, PendingAuth, Platform, SecretStore } from './types'

/**
 * Notes live in `Documents\Compass\` rather than hidden app storage, so they
 * can be opened, searched and backed up with any other tool. See
 * docs/SCOPE.md §8.4.
 */
const NOTES_DIR = 'Compass'
const NOTES_BASE = BaseDirectory.Document

const tauriSecrets: SecretStore = {
  get: (key) => invoke<string | null>('secret_get', { key }),
  set: (key, value) => invoke<void>('secret_set', { key, value }),
  delete: (key) => invoke<void>('secret_delete', { key }),
}

async function ensureNotesDir(): Promise<void> {
  if (!(await exists(NOTES_DIR, { baseDir: NOTES_BASE }))) {
    await mkdir(NOTES_DIR, { baseDir: NOTES_BASE, recursive: true })
  }
}

const notePath = (dayKey: string) => `${NOTES_DIR}/${dayKey}.md`

const tauriNotes: NoteStore = {
  async read(dayKey) {
    const path = notePath(dayKey)
    if (!(await exists(path, { baseDir: NOTES_BASE }))) return ''
    return readTextFile(path, { baseDir: NOTES_BASE })
  },

  async write(dayKey, markdown) {
    await ensureNotesDir()
    const path = notePath(dayKey)
    if (markdown.trim()) {
      await writeTextFile(path, markdown, { baseDir: NOTES_BASE })
    } else if (await exists(path, { baseDir: NOTES_BASE })) {
      // An emptied note removes its file rather than leaving a blank one
      // cluttering a folder the user actually browses.
      await remove(path, { baseDir: NOTES_BASE })
    }
  },

  async listDaysWithNotes() {
    if (!(await exists(NOTES_DIR, { baseDir: NOTES_BASE }))) return []
    const entries = await readDir(NOTES_DIR, { baseDir: NOTES_BASE })
    return entries
      .filter((entry) => entry.isFile && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
      .map((entry) => entry.name.replace(/\.md$/, ''))
      .sort()
  },
}

export function createTauriPlatform(): Platform {
  // The port is fixed for the lifetime of one sign-in attempt: it forms part of
  // the redirect_uri Google validates, and the same value must be replayed when
  // the code is exchanged.
  let redirectUri: string | null = null
  let pending: PendingAuth | null = null

  return {
    name: 'tauri',
    secrets: tauriSecrets,
    notes: tauriNotes,
    oauth: {
      async redirectUri() {
        if (!redirectUri) {
          const port = await invoke<number>('oauth_start')
          redirectUri = `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
        }
        return redirectUri
      },

      credentials(): ClientCredentials {
        return {
          clientId: GOOGLE_DESKTOP_CLIENT_ID,
          clientSecret: GOOGLE_DESKTOP_CLIENT_SECRET || undefined,
        }
      },

      async authorize(authUrl) {
        // Opened in the real browser, not an embedded webview: the user's
        // existing Google session is there, and Google blocks embedded webviews
        // for native app sign-in anyway.
        await openUrl(authUrl)
        try {
          return await invoke<string>('oauth_await')
        } finally {
          // Spent, whether it succeeded or not; the next attempt binds afresh.
          redirectUri = null
        }
      },

      async savePending(next) {
        pending = next
      },

      async takePending() {
        const held = pending
        pending = null
        return held
      },

      // The desktop app never boots into a callback — the loopback server
      // receives it while the app is already running.
      consumeRedirect: () => null,
    },
  }
}
