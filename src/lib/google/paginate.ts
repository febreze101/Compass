import type { GoogleClient } from './client'

/** The shape every paginated Google list endpoint returns. */
export interface GooglePage<T> {
  items?: T[]
  nextPageToken?: string
}

/**
 * Walks a paginated endpoint to completion.
 *
 * `buildUrl` receives the page token and returns the URL for that page. The
 * page cap is a guard against a malformed response whose `nextPageToken` never
 * advances — without it a bad page would spin forever.
 */
export async function collectPages<T>(
  client: GoogleClient,
  buildUrl: (pageToken?: string) => string,
  maxPages = 20,
): Promise<T[]> {
  const collected: T[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const response = await client.request<GooglePage<T>>(buildUrl(pageToken))
    collected.push(...(response.items ?? []))
    if (!response.nextPageToken || response.nextPageToken === pageToken) break
    pageToken = response.nextPageToken
  }
  return collected
}
