/**
 * Android implementation of the platform seam, on Capacitor 8.
 *
 * Differs from Tauri in the same three ways every platform does: the refresh
 * token lives in Capacitor's Preferences store (app-private, not Keychain-grade,
 * but sandboxed to this app) rather than Credential Manager; notes go to the
 * app's external-files directory, reachable from a file manager or USB rather
 * than hidden app storage; and Google's redirect is caught by a custom URL
 * scheme rather than a loopback server, because a phone can't bind a port the
 * system browser can reach back into.
 */

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { PluginListenerHandle } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'

import { GOOGLE_ANDROID_CLIENT_ID } from '../config'
import type { ClientCredentials } from '../lib/google/auth'
import type { NoteStore, PendingAuth, Platform, SecretStore } from './types'

/**
 * Notes live in the public Documents folder, not `Directory.External`
 * (`Android/data/…`) — that path is hidden from the Files app on Android 11+,
 * which would defeat docs/SCOPE.md §8.4's point of real, browsable files. This
 * is the Android analogue of Tauri's `Documents\Compass\`.
 */
const NOTES_DIR = 'Compass'
const NOTES_BASE = Directory.Documents

const capacitorSecrets: SecretStore = {
  async get(key) {
    const { value } = await Preferences.get({ key })
    return value
  },
  async set(key, value) {
    await Preferences.set({ key, value })
  },
  async delete(key) {
    await Preferences.remove({ key })
  },
}

async function ensureNotesDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: NOTES_DIR, directory: NOTES_BASE, recursive: true })
  } catch {
    // Already exists — Filesystem has no "exists" check that doesn't itself
    // throw on a missing path, so the create-and-ignore-conflict is simpler.
  }
}

const notePath = (dayKey: string) => `${NOTES_DIR}/${dayKey}.md`

const capacitorNotes: NoteStore = {
  async read(dayKey) {
    try {
      const { data } = await Filesystem.readFile({
        path: notePath(dayKey),
        directory: NOTES_BASE,
        encoding: Encoding.UTF8,
      })
      return typeof data === 'string' ? data : ''
    } catch {
      return ''
    }
  },

  async write(dayKey, markdown) {
    const path = notePath(dayKey)
    if (markdown.trim()) {
      await ensureNotesDir()
      await Filesystem.writeFile({ path, directory: NOTES_BASE, data: markdown, encoding: Encoding.UTF8 })
    } else {
      try {
        await Filesystem.deleteFile({ path, directory: NOTES_BASE })
      } catch {
        // Nothing to delete — an empty note that was never written.
      }
    }
  },

  async listDaysWithNotes() {
    try {
      const { files } = await Filesystem.readdir({ path: NOTES_DIR, directory: NOTES_BASE })
      return files
        .filter((entry) => entry.type === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
        .map((entry) => entry.name.replace(/\.md$/, ''))
        .sort()
    } catch {
      return []
    }
  },
}

/**
 * Google's own convention for installed-app redirects with no loopback
 * available: the client id, reversed into a scheme. A client id looks like
 * `123-abc.apps.googleusercontent.com`; the scheme is
 * `com.googleusercontent.apps.123-abc`. See docs/google-setup.md §5 — the
 * matching intent-filter lives in android/app/src/main/AndroidManifest.xml.
 */
function redirectScheme(clientId: string): string {
  const id = clientId.replace(/\.apps\.googleusercontent\.com$/, '')
  return `com.googleusercontent.apps.${id}`
}

export function createCapacitorPlatform(): Platform {
  let pending: PendingAuth | null = null

  return {
    name: 'capacitor',
    secrets: capacitorSecrets,
    notes: capacitorNotes,
    oauth: {
      async redirectUri() {
        return `${redirectScheme(GOOGLE_ANDROID_CLIENT_ID)}:/oauth2redirect`
      },

      credentials(): ClientCredentials {
        // Android clients take no secret — PKCE is the whole story here.
        return { clientId: GOOGLE_ANDROID_CLIENT_ID }
      },

      async authorize(authUrl) {
        // Opened in a Custom Tab (the system browser's cookies/session, not an
        // embedded webview Google would block for sign-in) via the Browser
        // plugin. The app stays running underneath — Android relaunches it via
        // the custom-scheme intent-filter when Google redirects back, which
        // fires `appUrlOpen` below.
        let handle: PluginListenerHandle | undefined
        try {
          return await new Promise<string>((resolve, reject) => {
            App.addListener('appUrlOpen', ({ url }) => resolve(url))
              .then((h) => {
                handle = h
              })
              .catch(reject)
            Browser.open({ url: authUrl }).catch(reject)
          })
        } finally {
          // Torn down every time, success or failure, so a later sign-in
          // attempt doesn't stack duplicate listeners on top of this one.
          await handle?.remove()
          await Browser.close().catch(() => {
            // Nothing to close if the browser already dismissed itself.
          })
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

      // The custom-scheme redirect arrives as a live `appUrlOpen` event while
      // the app process survives in the background, not as a cold boot into a
      // callback URL — Android does not kill the app just because the user
      // briefly left it for the browser.
      consumeRedirect: () => null,
    },
  }
}
