/**
 * Authenticated transport for the Google APIs.
 *
 * Owns exactly one concern: making sure a request goes out with a usable access
 * token, and recovering when it doesn't. Callers (`calendar.ts`, `tasks.ts`)
 * deal in URLs and payloads and never think about tokens.
 */

import { isExpired, refreshTokens, type ClientCredentials, type TokenSet } from './auth'

/** Persistence for the current session. Backed by the platform's secret store. */
export interface TokenStore {
  get(): Promise<TokenSet | null>
  set(tokens: TokenSet): Promise<void>
  clear(): Promise<void>
}

/**
 * The session is gone and cannot be recovered without the user signing in
 * again. Distinct from ordinary API failures so the UI can route it to the
 * sign-in screen rather than showing a generic error.
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

export interface GoogleClient {
  request<T>(url: string, init?: RequestInit): Promise<T>
}

interface GoogleApiErrorBody {
  error?: { message?: string; status?: string } | string
  error_description?: string
}

async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as GoogleApiErrorBody
  if (typeof body.error === 'object' && body.error?.message) return body.error.message
  if (typeof body.error === 'string') return body.error_description ?? body.error
  return `HTTP ${response.status}`
}

export function createGoogleClient(options: {
  tokens: TokenStore
  credentials: ClientCredentials
  /** Called when the session dies, so the app can drop to the sign-in screen. */
  onSignedOut?: () => void
}): GoogleClient {
  const { tokens: store, credentials } = options

  // A single in-flight refresh, shared by every caller that needs one. The
  // Today page issues four requests at once; without this they would each
  // refresh, and Google may invalidate the losers of that race.
  let inFlightRefresh: Promise<TokenSet> | null = null

  async function refresh(current: TokenSet): Promise<TokenSet> {
    if (!current.refreshToken) {
      await signOut()
      throw new AuthRequiredError('Session has no refresh token; sign in again.')
    }
    inFlightRefresh ??= (async () => {
      try {
        const next = await refreshTokens({
          refreshToken: current.refreshToken as string,
          credentials,
          scope: current.scope,
        })
        await store.set(next)
        return next
      } finally {
        inFlightRefresh = null
      }
    })()

    try {
      return await inFlightRefresh
    } catch (cause) {
      await signOut()
      throw new AuthRequiredError(
        `Could not refresh the Google session: ${(cause as Error).message}`,
      )
    }
  }

  async function signOut(): Promise<void> {
    await store.clear()
    options.onSignedOut?.()
  }

  async function currentAccessToken(forceRefresh: boolean): Promise<string> {
    const tokens = await store.get()
    if (!tokens) throw new AuthRequiredError('Not signed in to Google.')
    if (forceRefresh || isExpired(tokens)) return (await refresh(tokens)).accessToken
    return tokens.accessToken
  }

  async function send(url: string, init: RequestInit, accessToken: string): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${accessToken}`,
      },
    })
  }

  async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let response = await send(url, init, await currentAccessToken(false))

    // A 401 on a token we believed was valid means it was revoked or rotated
    // server-side. Refresh once and retry; a second 401 is not recoverable.
    if (response.status === 401) {
      response = await send(url, init, await currentAccessToken(true))
      if (response.status === 401) {
        await signOut()
        throw new AuthRequiredError('Google rejected the refreshed session.')
      }
    }

    if (!response.ok) {
      throw new Error(`Google API request failed: ${await describeFailure(response)}`)
    }
    // 204 No Content is normal for deletes.
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  return { request }
}
