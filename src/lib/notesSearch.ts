/**
 * Note search (docs/UPDATES.md §10.3) — rides along with sync rather than
 * being its own phase, since it's one query against the `notes` table sync
 * already stood up. Full-text search over local files would mean reading
 * every day's file on every keystroke; against Supabase it's one query.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayKey } from './date'

export interface NoteSearchResult {
  day: DayKey
  slug: string
}

/** Below this, a one- or two-letter query returns too much noise to be useful. */
const MIN_QUERY_LENGTH = 3
const MAX_RESULTS = 20

export async function searchNotes(
  client: SupabaseClient,
  query: string,
): Promise<NoteSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []

  const { data, error } = await client
    .from('notes')
    .select('day, slug')
    .ilike('body', `%${trimmed}%`)
    .order('day', { ascending: false })
    .limit(MAX_RESULTS)

  if (error || !data) return []
  return data as NoteSearchResult[]
}
