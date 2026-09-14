import { useEffect, useState } from 'react'
import { useApp } from '../state/store'
import { searchNotes, type NoteSearchResult } from '../lib/notesSearch'
import { supabase } from '../lib/supabase'

/** Coalesces keystrokes before hitting Supabase, same idea as the note autosave. */
const DEBOUNCE_MS = 300

/**
 * Search across every day's note (docs/UPDATES.md §10.3). Lives in the
 * Sources sheet — the closest existing analog for a settings-shaped panel —
 * rather than a section of its own on the Today page.
 *
 * Renders nothing when Supabase isn't configured: search is a side effect of
 * sync existing, not a feature the app can offer without it.
 */
export function NoteSearch() {
  const goToDay = useApp((s) => s.goToDay)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteSearchResult[]>([])
  const client = supabase()

  const trimmed = query.trim()

  useEffect(() => {
    if (!client || !trimmed) return
    let cancelled = false
    const timer = setTimeout(() => {
      void searchNotes(client, query).then((found) => {
        if (!cancelled) setResults(found)
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, query, trimmed])

  if (!client) return null

  // Derived rather than cleared from the effect above: an emptied query
  // shouldn't wait on a render cycle to stop showing stale results.
  const shown = trimmed ? results : []

  return (
    <div className="sources__group">
      <h3 className="section__title">Search notes</h3>
      <input
        className="capture__input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every day's note"
        aria-label="Search notes"
      />
      {shown.map((result) => (
        <button
          type="button"
          className="sources__label"
          key={`${result.day}-${result.slug}`}
          onClick={() => void goToDay(result.day)}
        >
          {result.day}
        </button>
      ))}
    </div>
  )
}
