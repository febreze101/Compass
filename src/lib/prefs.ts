/**
 * Local preferences: which calendars and task lists feed the day view.
 *
 * Not synced anywhere — a per-device choice, like which panes you keep open.
 */

const PREFS_KEY = 'compass.prefs'

/**
 * A saved source choice.
 *
 * `known` is the part that makes this work: it records every source id seen at
 * the time of saving, so a source missing from `selected` can be told apart
 * from one that simply didn't exist yet.
 */
export interface SourceSelection {
  selected: string[]
  known: string[]
}

export interface Prefs {
  calendars?: SourceSelection
  taskLists?: SourceSelection
}

/**
 * Reconciles a saved choice against the sources that actually exist now.
 *
 * New sources default to on — a calendar you just created in Google appearing
 * automatically is expected; having to hunt for a checkbox to reveal it reads
 * as a bug.
 */
export function resolveSelection(
  available: string[],
  saved: SourceSelection | null | undefined,
): string[] {
  if (!saved) return [...available]
  const selected = new Set(saved.selected)
  const known = new Set(saved.known)
  return available.filter((id) => selected.has(id) || !known.has(id))
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  } catch {
    return {}
  }
}

function writePrefs(next: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // A full or disabled store shouldn't take the app down; the user just
    // loses the preference.
  }
}

export function loadSelection(kind: keyof Prefs): SourceSelection | null {
  return readPrefs()[kind] ?? null
}

export function saveSelection(kind: keyof Prefs, selection: SourceSelection): void {
  writePrefs({ ...readPrefs(), [kind]: selection })
}
