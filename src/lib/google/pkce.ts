/**
 * PKCE (RFC 7636) — the thing that actually secures OAuth for an installed app.
 *
 * Compass ships its client credentials inside the binary, so they can't be
 * treated as secret. PKCE closes the gap: the authorization code is bound to a
 * one-time verifier that never leaves the device, so an intercepted code is
 * useless on its own.
 */

/** Base64url without padding, per RFC 7636 §4.2. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * A fresh code verifier. 32 random bytes become 43 base64url characters — the
 * minimum RFC 7636 allows, and comfortably beyond guessing.
 */
export function createVerifier(): string {
  return base64UrlEncode(randomBytes(32))
}

/** The S256 challenge derived from a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

/** Opaque value echoed back by the provider, to tie a callback to the request that started it. */
export function randomState(): string {
  return base64UrlEncode(randomBytes(16))
}
