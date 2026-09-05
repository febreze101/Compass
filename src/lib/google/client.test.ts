import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, createGoogleClient, type TokenStore } from './client'
import type { TokenSet } from './auth'

const NOW = new Date('2026-09-05T12:00:00Z').getTime()
const creds = { clientId: 'id', clientSecret: 'secret' }

const fresh = (): TokenSet => ({ accessToken: 'good-at', refreshToken: 'rt', expiresAt: NOW + 3_600_000 })
const stale = (): TokenSet => ({ accessToken: 'old-at', refreshToken: 'rt', expiresAt: NOW - 1000 })

function memoryStore(initial: TokenSet | null): TokenStore & { current: TokenSet | null } {
  const store = {
    current: initial,
    get: async () => store.current,
    set: async (t: TokenSet) => { store.current = t },
    clear: async () => { store.current = null },
  }
  return store
}

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createGoogleClient', () => {
  it('attaches the access token as a bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGoogleClient({ tokens: memoryStore(fresh()), credentials: creds })

    await client.request('https://example.test/x')

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer good-at')
  })

  it('refuses to call the API when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const client = createGoogleClient({ tokens: memoryStore(null), credentials: creds })
    await expect(client.request('https://example.test/x')).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('refreshes proactively when the token is expired, then calls the API once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'new-at', expires_in: 3599 })) // token endpoint
      .mockResolvedValueOnce(json({ data: 1 })) // the actual API call
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryStore(stale())
    const client = createGoogleClient({ tokens: store, credentials: creds })

    await client.request('https://example.test/x')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    const headers = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer new-at')
  })

  it('persists refreshed tokens, keeping the refresh token Google omitted', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'new-at', expires_in: 3599 }))
      .mockResolvedValueOnce(json({})))
    const store = memoryStore(stale())
    await createGoogleClient({ tokens: store, credentials: creds }).request('https://example.test/x')

    expect(store.current?.accessToken).toBe('new-at')
    expect(store.current?.refreshToken).toBe('rt')
  })

  it('retries once when the API rejects a token it believed was valid', async () => {
    // Tokens can be revoked server-side before their nominal expiry.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'Invalid Credentials' } }, 401))
      .mockResolvedValueOnce(json({ access_token: 'new-at', expires_in: 3599 }))
      .mockResolvedValueOnce(json({ data: 'recovered' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGoogleClient({ tokens: memoryStore(fresh()), credentials: creds })

    await expect(client.request('https://example.test/x')).resolves.toEqual({ data: 'recovered' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after a single retry rather than looping', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'Invalid Credentials' } }, 401))
      .mockResolvedValueOnce(json({ access_token: 'new-at', expires_in: 3599 }))
      .mockResolvedValueOnce(json({ error: { message: 'Invalid Credentials' } }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGoogleClient({ tokens: memoryStore(fresh()), credentials: creds })

    await expect(client.request('https://example.test/x')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clears the session when the refresh token has been revoked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400),
    ))
    const store = memoryStore(stale())
    const client = createGoogleClient({ tokens: store, credentials: creds })

    await expect(client.request('https://example.test/x')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(store.current).toBeNull()
  })

  it('refreshes only once when several requests race a stale token', async () => {
    // The Today page fires calendars, events, task lists and tasks together.
    // Four parallel refreshes would invalidate each other.
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url === 'https://oauth2.googleapis.com/token'
          ? json({ access_token: 'new-at', expires_in: 3599 })
          : json({ data: 'ok' }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createGoogleClient({ tokens: memoryStore(stale()), credentials: creds })

    await Promise.all([
      client.request('https://example.test/a'),
      client.request('https://example.test/b'),
      client.request('https://example.test/c'),
      client.request('https://example.test/d'),
    ])

    const tokenCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === 'https://oauth2.googleapis.com/token',
    )
    expect(tokenCalls).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('surfaces API errors with Google’s message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ error: { message: 'Calendar usage limits exceeded.' } }, 403),
    ))
    const client = createGoogleClient({ tokens: memoryStore(fresh()), credentials: creds })
    await expect(client.request('https://example.test/x')).rejects.toThrow(/usage limits/i)
  })
})
