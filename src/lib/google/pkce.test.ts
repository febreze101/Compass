import { describe, expect, it } from 'vitest'
import { challengeFor, createVerifier, randomState } from './pkce'

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/
const BASE64URL = /^[A-Za-z0-9\-_]+$/

describe('createVerifier', () => {
  it('produces a verifier of RFC 7636 legal length', () => {
    const v = createVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('uses only unreserved characters', () => {
    expect(createVerifier()).toMatch(UNRESERVED)
  })

  it('is different every call', () => {
    const seen = new Set(Array.from({ length: 20 }, () => createVerifier()))
    expect(seen.size).toBe(20)
  })
})

describe('challengeFor', () => {
  it('matches the RFC 7636 Appendix B reference vector', async () => {
    // The canonical S256 test vector. If this passes, the implementation is
    // correct rather than merely self-consistent.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    await expect(challengeFor(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('emits unpadded base64url', async () => {
    const challenge = await challengeFor(createVerifier())
    expect(challenge).toMatch(BASE64URL)
    expect(challenge).not.toContain('=')
    expect(challenge.length).toBe(43) // 32 bytes, base64url, unpadded
  })

  it('is deterministic for a given verifier', async () => {
    const v = createVerifier()
    expect(await challengeFor(v)).toBe(await challengeFor(v))
  })
})

describe('randomState', () => {
  it('is url-safe and unguessable', () => {
    const s = randomState()
    expect(s).toMatch(UNRESERVED)
    expect(s.length).toBeGreaterThanOrEqual(16)
  })

  it('is different every call', () => {
    expect(randomState()).not.toBe(randomState())
  })
})
