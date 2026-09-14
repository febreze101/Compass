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

/** The session, persisted through the platform's secret store. */
export function createTokenStore(platform: Platform): TokenStore {
  return {
    async get() {
      const raw = await platform.secrets.get(TOKENS_KEY)
      if (!raw) return null
      try {
        return JSON.parse(raw) as TokenSet
      } catch {
        // Corrupt storage should log the user out, not brick the app.
        await platform.secrets.delete(TOKENS_KEY)
        return null
      }
    },
    async set(tokens) {
      await platform.secrets.set(TOKENS_KEY, JSON.stringify(tokens))
    },
    async clear() {
      await platform.secrets.delete(TOKENS_KEY)
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
 * Called on every sign-in, and again on every resumed session as a
 * self-heal: `supabase.ts` persists and auto-refreshes its own session
 * independently, so this second call is usually a no-op confirming that
 * session is still good — but if it's ever missing (a cleared browser
 * profile, an upgrade from before persistence was added), this is what
 * re-establishes it, as long as the Google ID token from the original
 * sign-in hasn't expired.
 */
export async function syncSupabaseAuth(tokens: TokenSet): Promise<void> {
  const client = supabase()
  if (!client || !tokens.idToken) return
  try {
    await client.auth.signInWithIdToken({ provider: 'google', token: tokens.idToken })
  } catch {
    // Swallowed on purpose — see the note above. Note sync just stays off
    // until the next successful attempt.
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
