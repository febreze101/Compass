import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAuthUrl, exchangeCode, isExpired, refreshTokens } from './auth'
import type { TokenSet } from './auth'

const creds = { clientId: 'desktop-id', clientSecret: 'desktop-secret' }
const NOW = new Date('2026-09-05T12:00:00Z').getTime()

function mockJson(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('buildAuthUrl', () => {
  const url = () =>
    new URL(
      buildAuthUrl({
        clientId: 'desktop-id',
        redirectUri: 'http://127.0.0.1:4321/oauth/callback',
        codeChallenge: 'challenge-value',
        state: 'state-value',
      }),
    )

  it('targets Google’s authorization endpoint', () => {
    expect(url().origin + url().pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  })

  it('requests an authorization code with S256 PKCE', () => {
    const p = url().searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('code_challenge')).toBe('challenge-value')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('state-value')
    expect(p.get('client_id')).toBe('desktop-id')
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:4321/oauth/callback')
  })

  it('asks for offline access and forces consent, so a refresh token comes back', () => {
    // Without both of these Google returns no refresh_token on repeat
    // authorizations, and the app silently degrades to hourly re-login.
    const p = url().searchParams
    expect(p.get('access_type')).toBe('offline')
    expect(p.get('prompt')).toBe('consent')
  })

  it('requests calendar and tasks scopes', () => {
    const scope = url().searchParams.get('scope') ?? ''
    expect(scope).toContain('auth/calendar.events')
    expect(scope).toContain('auth/tasks')
  })
})

describe('isExpired', () => {
  const tokens = (expiresAt: number): TokenSet => ({ accessToken: 'a', expiresAt })

  it('is false well before expiry', () => {
    expect(isExpired(tokens(NOW + 3_600_000))).toBe(false)
  })

  it('is true after expiry', () => {
    expect(isExpired(tokens(NOW - 1))).toBe(true)
  })

  it('treats tokens expiring within the skew window as already expired', () => {
    // A token with 10s left will die mid-request; refresh it first.
    expect(isExpired(tokens(NOW + 10_000))).toBe(true)
  })
})

describe('exchangeCode', () => {
  it('posts the code, verifier and credentials as form data', async () => {
    const fetchMock = mockJson({
      access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 's', token_type: 'Bearer',
    })
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCode({
      code: 'the-code',
      verifier: 'the-verifier',
      redirectUri: 'http://127.0.0.1:4321/oauth/callback',
      credentials: creds,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('client_id')).toBe('desktop-id')
    expect(body.get('client_secret')).toBe('desktop-secret')
  })

  it('converts expires_in into an absolute timestamp', async () => {
    vi.stubGlobal('fetch', mockJson({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 }))
    const tokens = await exchangeCode({
      code: 'c', verifier: 'v', redirectUri: 'r', credentials: creds,
    })
    expect(tokens.expiresAt).toBe(NOW + 3599 * 1000)
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
  })

  it('omits client_secret for clients that have none, such as Android', async () => {
    const fetchMock = mockJson({ access_token: 'at', expires_in: 3599 })
    vi.stubGlobal('fetch', fetchMock)
    await exchangeCode({
      code: 'c', verifier: 'v', redirectUri: 'r', credentials: { clientId: 'android-id' },
    })
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string)
    expect(body.has('client_secret')).toBe(false)
  })

  it('surfaces Google’s error description on failure', async () => {
    vi.stubGlobal('fetch', mockJson(
      { error: 'invalid_grant', error_description: 'Bad Request' }, false, 400,
    ))
    await expect(
      exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'r', credentials: creds }),
    ).rejects.toThrow(/invalid_grant.*Bad Request|Bad Request/)
  })
})

describe('refreshTokens', () => {
  it('sends the refresh grant', async () => {
    const fetchMock = mockJson({ access_token: 'at2', expires_in: 3599 })
    vi.stubGlobal('fetch', fetchMock)
    await refreshTokens({ refreshToken: 'rt', credentials: creds })
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
  })

  it('KEEPS the existing refresh token when Google omits it from the response', async () => {
    // Google returns no refresh_token on a refresh. Naively mapping the
    // response drops it, and the next refresh fails with invalid_grant —
    // presenting as "randomly signed out after an hour".
    vi.stubGlobal('fetch', mockJson({ access_token: 'at2', expires_in: 3599 }))
    const tokens = await refreshTokens({ refreshToken: 'original-rt', credentials: creds })
    expect(tokens.refreshToken).toBe('original-rt')
    expect(tokens.accessToken).toBe('at2')
  })

  it('adopts a rotated refresh token when Google does send one', async () => {
    vi.stubGlobal('fetch', mockJson({ access_token: 'at2', refresh_token: 'rotated', expires_in: 60 }))
    const tokens = await refreshTokens({ refreshToken: 'original-rt', credentials: creds })
    expect(tokens.refreshToken).toBe('rotated')
  })

  it('reports a revoked grant clearly', async () => {
    vi.stubGlobal('fetch', mockJson(
      { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      false, 400,
    ))
    await expect(refreshTokens({ refreshToken: 'rt', credentials: creds })).rejects.toThrow(
      /revoked/i,
    )
  })
})
