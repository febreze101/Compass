import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginSignIn, completeSignIn, createTokenStore, restoreSession, signOut } from './session'
import type { Platform, PendingAuth } from '../platform/types'

const NOW = new Date('2026-09-05T12:00:00Z').getTime()
const CALLBACK = 'http://127.0.0.1:5173/oauth/callback'

function fakePlatform(): Platform & { authorized: string[]; pending: PendingAuth | null } {
  const secrets = new Map<string, string>()
  const self = {
    name: 'web' as const,
    authorized: [] as string[],
    pending: null as PendingAuth | null,
    secrets: {
      get: async (k: string) => secrets.get(k) ?? null,
      set: async (k: string, v: string) => void secrets.set(k, v),
      delete: async (k: string) => void secrets.delete(k),
    },
    notes: {
      read: async () => '',
      write: async () => {},
      listDaysWithNotes: async () => [],
    },
    oauth: {
      redirectUri: async () => 'http://127.0.0.1:5173/oauth/callback',
      credentials: () => ({ clientId: 'desktop-id', clientSecret: 'desktop-secret' }),
      authorize: async (url: string) => {
        self.authorized.push(url)
        return 'http://127.0.0.1:5173/oauth/callback?code=the-code&state=' + (self.pending?.state ?? '')
      },
      savePending: async (p: PendingAuth) => void (self.pending = p),
      takePending: async () => {
        const p = self.pending
        self.pending = null
        return p
      },
      consumeRedirect: () => null,
    },
  }
  return self
}

const tokenResponse = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 }),
  text: async () => '',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('beginSignIn', () => {
  it('sends the user to Google with a challenge derived from a saved verifier', async () => {
    const p = fakePlatform()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse))

    await beginSignIn(p)

    const url = new URL(p.authorized[0])
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/oauth/callback')
  })

  it('exchanges the code against the redirect uri the authorization used', async () => {
    // The Tauri shell binds a fresh ephemeral port for every attempt, so
    // `redirectUri()` is deliberately not idempotent. Resolving it a second
    // time at exchange time sent Google a redirect_uri it had never issued the
    // code against, which it rejects as `invalid_grant` / "Bad Request".
    const p = fakePlatform()
    let port = 5000
    p.oauth.redirectUri = async () => `http://127.0.0.1:${port++}/oauth/callback`
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse)
    vi.stubGlobal('fetch', fetchMock)

    await beginSignIn(p)

    const authorized = new URL(p.authorized[0]).searchParams.get('redirect_uri')
    const exchanged = new URLSearchParams(fetchMock.mock.calls[0][1].body as string).get(
      'redirect_uri',
    )
    expect(authorized).toBe('http://127.0.0.1:5000/oauth/callback')
    expect(exchanged).toBe(authorized)
  })

  it('refuses to start when no client id is configured', async () => {
    const p = fakePlatform()
    p.oauth.credentials = () => ({ clientId: '' })
    await expect(beginSignIn(p)).rejects.toThrow(/client id|\.env/i)
  })
})

describe('completeSignIn', () => {
  it('exchanges the code and stores the session', async () => {
    const p = fakePlatform()
    await p.oauth.savePending({ verifier: 'v', state: 'st', redirectUri: CALLBACK })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse))

    const tokens = await completeSignIn(
      p,
      'http://127.0.0.1:5173/oauth/callback?code=the-code&state=st',
    )

    expect(tokens.accessToken).toBe('at')
    expect(await createTokenStore(p).get()).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
  })

  it('rejects a callback whose state does not match the request', async () => {
    // A mismatched state means the callback did not originate from this app's
    // sign-in attempt. Exchanging the code anyway is the CSRF hole PKCE and
    // state exist to close.
    const p = fakePlatform()
    await p.oauth.savePending({ verifier: 'v', state: 'expected', redirectUri: CALLBACK })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      completeSignIn(p, 'http://127.0.0.1:5173/oauth/callback?code=c&state=attacker'),
    ).rejects.toThrow(/state/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when there is no pending request at all', async () => {
    const p = fakePlatform()
    await expect(
      completeSignIn(p, 'http://127.0.0.1:5173/oauth/callback?code=c&state=whatever'),
    ).rejects.toThrow(/no sign-in/i)
  })

  it('surfaces the error Google put in the callback', async () => {
    const p = fakePlatform()
    await p.oauth.savePending({ verifier: 'v', state: 'st', redirectUri: CALLBACK })
    await expect(
      completeSignIn(p, 'http://127.0.0.1:5173/oauth/callback?error=access_denied&state=st'),
    ).rejects.toThrow(/access_denied/)
  })

  it('rejects a callback carrying neither code nor error', async () => {
    const p = fakePlatform()
    await p.oauth.savePending({ verifier: 'v', state: 'st', redirectUri: CALLBACK })
    await expect(
      completeSignIn(p, 'http://127.0.0.1:5173/oauth/callback?state=st'),
    ).rejects.toThrow(/code/i)
  })
})

describe('restoreSession / signOut', () => {
  it('returns null when nothing was stored', async () => {
    expect(await restoreSession(fakePlatform())).toBeNull()
  })

  it('round-trips a stored session', async () => {
    const p = fakePlatform()
    await createTokenStore(p).set({ accessToken: 'at', refreshToken: 'rt', expiresAt: NOW + 1000 })
    expect(await restoreSession(p)).toMatchObject({ accessToken: 'at' })
  })

  it('ignores corrupt stored data instead of crashing the app', async () => {
    const p = fakePlatform()
    await p.secrets.set('google.tokens', 'not json{{')
    expect(await restoreSession(p)).toBeNull()
  })

  it('clears the session on sign out', async () => {
    const p = fakePlatform()
    await createTokenStore(p).set({ accessToken: 'at', expiresAt: NOW })
    await signOut(p)
    expect(await restoreSession(p)).toBeNull()
  })
})
