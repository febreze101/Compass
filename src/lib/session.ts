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
  await platform.oauth.savePending({ verifier, state })

  const authUrl = buildAuthUrl({
    clientId: credentials.clientId,
    redirectUri: await platform.oauth.redirectUri(),
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
    redirectUri: await platform.oauth.redirectUri(),
    credentials: platform.oauth.credentials(),
  })

  await createTokenStore(platform).set(tokens)
  return tokens
}
