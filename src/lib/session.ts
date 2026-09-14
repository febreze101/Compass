/**
 * Sign-in orchestration: the interactive flow, and the stored session.
 *
 * Sits between the pure OAuth transport (`google/auth.ts`) and the platform
 * seam, so neither has to know about the other.
 */

import type { Platform } from '../platform/types'
import { buildAuthUrl, exchangeCode, type TokenSet } from './google/auth'
import type { TokenStore } from './google/client'
import { challengeFor, createVerifier, randomState } from './google/pkce'
import { supabase } from './supabase'

const TOKENS_KEY = 'google.tokens'
/**
 * Stored separately from `TOKENS_KEY`, not folded into the same JSON blob.
 * Windows Credential Manager (the `keyring` crate's backend for
 * `secret_set`/`secret_get`, see `src-tauri/src/lib.rs`) caps a single
 * credential's value at 2560 UTF-16 characters. The access/refresh token
 * plus scope fit under that alone; adding the ID token's full JWT on top
 * pushed it over, and failed with "password encoded as UTF-16 is longer
 * than platform limit of 2560 chars" — a Rust-side error with nothing in it
 * pointing at which field was the culprit.
 */
const ID_TOKEN_KEY = 'google.idToken'

/** The session, persisted through the platform's secret store. */
export function createTokenStore(platform: Platform): TokenStore {
  return {
    async get() {
      const raw = await platform.secrets.get(TOKENS_KEY)
      if (!raw) return null
      try {
        const tokens = JSON.parse(raw) as TokenSet
        const idToken = await platform.secrets.get(ID_TOKEN_KEY)
        return idToken ? { ...tokens, idToken } : tokens
      } catch {
        // Corrupt storage should log the user out, not brick the app.
        await platform.secrets.delete(TOKENS_KEY)
        await platform.secrets.delete(ID_TOKEN_KEY)
        return null
      }
    },
    async set(tokens) {
      const { idToken, ...rest } = tokens
      await platform.secrets.set(TOKENS_KEY, JSON.stringify(rest))
      // Not every session has one (e.g. one from before openid/email was
      // added to the scope list) — nothing to store, and nothing stale to
      // leave behind either.
      if (idToken) await platform.secrets.set(ID_TOKEN_KEY, idToken)
      else await platform.secrets.delete(ID_TOKEN_KEY)
    },
    async clear() {
      await platform.secrets.delete(TOKENS_KEY)
      await platform.secrets.delete(ID_TOKEN_KEY)
    },
  }
}

export function restoreSession(platform: Platform): Promise<TokenSet | null> {
  return createTokenStore(platform).get()
}

export function signOut(platform: Platform): Promise<void> {
  return createTokenStore(platform).clear()
}

/**
 * Authenticates to Supabase as the same Google user, via the ID token Google
 * just issued (docs/UPDATES.md §1.5). Best-effort: sync is a mirror, never
 * the source of truth (SCOPE.md §8.4), so a Supabase outage or a missing
 * `.env.local` entry must not block Google sign-in, which is what the rest
 * of the app actually depends on.
 *
 * Called on every sign-in and every resumed session — `persistSession` is
 * off (see `supabase.ts`), so each fresh boot needs its own exchange.
 */
export async function syncSupabaseAuth(tokens: TokenSet): Promise<void> {
  const client = supabase()
  if (!client) return
  if (!tokens.idToken) {
    // Expected right after the openid/email scope was added: the stored
    // session is still the one from before, with no ID token on it. Fixed
    // by disconnecting and reconnecting Google once, not by anything here.
    console.warn(
      'Compass: no Google ID token on this session, so Supabase sync stayed off. ' +
        'Disconnect and reconnect Google to get a fresh one.',
    )
    return
  }
  try {
    const { error } = await client.auth.signInWithIdToken({ provider: 'google', token: tokens.idToken })
    if (error) throw error
  } catch (error) {
    // Never fatal — see the note above, sync is a mirror, not a dependency.
    // Logged rather than fully silent, since a Supabase misconfiguration
    // (the Google provider's Client IDs in the dashboard, most commonly)
    // otherwise fails invisibly: every write past this point 403s on RLS
    // with no obvious cause.
    console.warn('Compass: Supabase sign-in failed, note sync and evergreen tasks are off.', error)
  }
}

/**
 * Starts the interactive flow.
 *
 * On platforms that can capture the redirect in-process this returns the
 * finished session. In the browser the page navigates away and never comes
 * back here — `completeSignIn` picks it up on the next boot instead.
 */
export async function beginSignIn(platform: Platform): Promise<TokenSet | null> {
  const credentials = platform.oauth.credentials()
  if (!credentials.clientId) {
    throw new Error(
      'No Google client id configured. Copy .env.example to .env.local and follow docs/google-setup.md.',
    )
  }

  const verifier = createVerifier()
  const state = randomState()

  // Resolved exactly once, then carried through the round trip. The Tauri shell
  // binds a fresh ephemeral port per attempt, so asking a second time at
  // exchange time would present Google a redirect_uri it never issued the code
  // against — rejected as `invalid_grant`, described only as "Bad Request".
  const redirectUri = await platform.oauth.redirectUri()
  await platform.oauth.savePending({ verifier, state, redirectUri })

  const authUrl = buildAuthUrl({
    clientId: credentials.clientId,
    redirectUri,
    codeChallenge: await challengeFor(verifier),
    state,
  })

  const redirectUrl = await platform.oauth.authorize(authUrl)
  return completeSignIn(platform, redirectUrl)
}

/** Finishes the flow from the URL Google redirected back to. */
export async function completeSignIn(platform: Platform, redirectUrl: string): Promise<TokenSet> {
  const params = new URL(redirectUrl).searchParams
  const pending = await platform.oauth.takePending()
  if (!pending) {
    throw new Error('No sign-in is in progress. Start again from the sign-in screen.')
  }

  const error = params.get('error')
  if (error) {
    throw new Error(`Google declined the sign-in: ${error}`)
  }

  // Checked before anything is exchanged: a state that doesn't match means the
  // callback didn't come from this app's request.
  if (params.get('state') !== pending.state) {
    throw new Error('Sign-in state did not match. Start again from the sign-in screen.')
  }

  const code = params.get('code')
  if (!code) {
    throw new Error('Google returned no authorization code.')
  }

  const tokens = await exchangeCode({
    code,
    verifier: pending.verifier,
    redirectUri: pending.redirectUri,
    credentials: platform.oauth.credentials(),
  })

  await createTokenStore(platform).set(tokens)
  await syncSupabaseAuth(tokens)
  return tokens
}
