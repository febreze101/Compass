/**
 * Google OAuth 2.0 token lifecycle.
 *
 * Pure transport — no storage, no UI, no platform assumptions. The interactive
 * half (getting the user to Google and catching the redirect) lives behind the
 * platform `OAuthBridge`; this module only builds the URL and trades codes and
 * refresh tokens for access tokens.
 */

import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
} from '../../config'

/** OAuth client credentials. `clientSecret` is absent for Android clients. */
export interface ClientCredentials {
  clientId: string
  clientSecret?: string
}

export interface TokenSet {
  accessToken: string
  /** Absent only if Google withheld it — see `refreshTokens`. */
  refreshToken?: string
  /** Absolute epoch-ms expiry, not the relative `expires_in` Google sends. */
  expiresAt: number
  scope?: string
}

/**
 * Refresh this long before nominal expiry. An access token with a few seconds
 * left will expire mid-flight and fail the request it was fetched for.
 */
const EXPIRY_SKEW_MS = 60_000

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export function buildAuthUrl(params: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  loginHint?: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
    // Together these are what make Google issue a refresh token. Without
    // `prompt=consent`, a user who has authorized before gets an access token
    // only, and the app can't stay signed in.
    access_type: 'offline',
    prompt: 'consent',
  })
  if (params.loginHint) query.set('login_hint', params.loginHint)
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`
}

/** True when `tokens` is expired, or close enough that it shouldn't be used. */
export function isExpired(tokens: TokenSet, now: number = Date.now()): boolean {
  return tokens.expiresAt - EXPIRY_SKEW_MS <= now
}

async function postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse
  if (!response.ok || payload.error) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`
    throw new Error(`Google token request failed: ${detail}`)
  }
  if (!payload.access_token) {
    throw new Error('Google token request returned no access_token')
  }
  return payload
}

function credentialFields(credentials: ClientCredentials): Record<string, string> {
  return credentials.clientSecret
    ? { client_id: credentials.clientId, client_secret: credentials.clientSecret }
    : { client_id: credentials.clientId }
}

function toTokenSet(payload: GoogleTokenResponse, now: number): TokenSet {
  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token,
    expiresAt: now + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope,
  }
}

/** Trades an authorization code plus its PKCE verifier for a token set. */
export async function exchangeCode(params: {
  code: string
  verifier: string
  redirectUri: string
  credentials: ClientCredentials
}): Promise<TokenSet> {
  const payload = await postToken(
    new URLSearchParams({
      ...credentialFields(params.credentials),
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri,
    }),
  )
  return toTokenSet(payload, Date.now())
}

/**
 * Exchanges a refresh token for a fresh access token.
 *
 * Google normally omits both `refresh_token` and `scope` from this response, so
 * the incoming values are carried forward. Dropping the refresh token would
 * break the *next* refresh, surfacing as being signed out an hour later for no
 * visible reason; dropping the scope would silently blind the startup
 * permission check.
 */
export async function refreshTokens(params: {
  refreshToken: string
  credentials: ClientCredentials
  /** Scope from the existing session, carried forward if Google omits it. */
  scope?: string
}): Promise<TokenSet> {
  const payload = await postToken(
    new URLSearchParams({
      ...credentialFields(params.credentials),
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
    }),
  )
  const tokens = toTokenSet(payload, Date.now())
  return {
    ...tokens,
    refreshToken: tokens.refreshToken ?? params.refreshToken,
    // Google usually omits  here too. Losing it would blind the
    // startup permission check, so a session missing a permission would stop
    // reporting it and fail obscurely on a data request instead.
    scope: tokens.scope ?? params.scope,
  }
}
