/**
 * The platform seam.
 *
 * Tauri on Windows, Capacitor on Android, and a plain browser for development
 * differ in exactly four ways: where secrets go, where notes go, how the OAuth
 * redirect gets back into the app, and which OAuth client they authenticate as.
 * Everything above this layer is shared.
 */

import type { ClientCredentials } from '../lib/google/auth'

export type PlatformName = 'tauri' | 'capacitor' | 'web'

/** Small key/value store for the session. Backed by the OS keychain where one exists. */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Daily notes, one Markdown document per calendar day, keyed `YYYY-MM-DD`. */
export interface NoteStore {
  read(dayKey: string): Promise<string>
  write(dayKey: string, markdown: string): Promise<void>
  /** Days that have a non-empty note, for marking them in the date bar. */
  listDaysWithNotes(): Promise<string[]>
}

/** PKCE state that has to survive the trip out to Google and back. */
export interface PendingAuth {
  verifier: string
  state: string
}

export interface OAuthBridge {
  /** The `redirect_uri` this platform receives on. */
  redirectUri(): Promise<string>

  /** OAuth client this platform authenticates as — Desktop or Android. */
  credentials(): ClientCredentials

  /**
   * Sends the user to `authUrl` and resolves with the redirect URL Google
   * returns.
   *
   * On platforms that navigate the whole app away (the browser), this never
   * resolves — the page unloads, and the flow resumes via
   * `consumeRedirect()` on the next boot.
   */
  authorize(authUrl: string): Promise<string>

  /** Stashes PKCE state across the round trip. */
  savePending(pending: PendingAuth): Promise<void>
  /** Retrieves and clears the stashed PKCE state. */
  takePending(): Promise<PendingAuth | null>

  /**
   * If the app booted *into* an OAuth callback, the redirect URL — consumed
   * once, so a reload doesn't retry a spent authorization code.
   */
  consumeRedirect(): string | null
}

export interface Platform {
  name: PlatformName
  secrets: SecretStore
  notes: NoteStore
  oauth: OAuthBridge
}
