/**
 * Note sync — mirrors the local `NoteStore` into Supabase's `notes` table so
 * a note written on one device shows up on another. See docs/UPDATES.md §1.
 *
 * The local `.md` file stays the source of truth (SCOPE.md §8.4): this is a
 * decorator behind the existing `NoteStore` seam, not a replacement for it.
 * `read`/`write`/`listDaysWithNotes` behave exactly as the wrapped store's
 * do — sync happens in the background on write, and `pull()` is the one
 * addition, called from the pull points in `state/store.ts` and `App.tsx`.
 *
 * Multinotes (docs/UPDATES.md §5) aren't built, so every row uses the empty
 * `slug` — the schema already has the column so that arrives as a migration
 * later, not now.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayKey } from './date'
import type { NoteStore } from '../platform/types'

const DAILY_NOTE_SLUG = ''

interface SyncEntry {
  /** `updated_at` of the remote row as of the last successful sync, or `null`
   * if this day has never been pushed. */
  remoteUpdatedAt: string | null
  /** Epoch ms of the local write this entry reflects. */
  localUpdatedAt: number
  hash: string
}

type SyncState = Partial<Record<DayKey, SyncEntry>>

interface RemoteNote {
  body: string
  updatedAt: string
}

export interface SyncedNoteStore extends NoteStore {
  /** Reconciles one day against Supabase. See `decideSync` for the rules. */
  pull(day: DayKey): Promise<void>
}

/**
 * Cheap, non-cryptographic — this only has to notice "did the file change
 * since the last sync", not resist tampering.
 */
export function hashNote(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33 + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

export type SyncAction =
  | { kind: 'noop' }
  | { kind: 'pushLocal' }
  | { kind: 'pullRemote'; body: string }
  | { kind: 'merge'; body: string }

/**
 * Pure decision logic for one day, given what's on disk, what's in
 * Supabase, and what was last known to be true when the two agreed. The one
 * part of sync worth testing without a network — everything else in this
 * file is I/O around this function.
 *
 * Rule (docs/UPDATES.md §1.4): last-write-wins by timestamp, except a
 * losing edit is never discarded — it's appended under a `<!-- conflict -->`
 * marker instead of dropped.
 */
export function decideSync(params: {
  localBody: string
  localHash: string
  /** Epoch ms of the local write `lastSynced` reflects, or 0 if never synced. */
  localUpdatedAt: number
  remote: RemoteNote | null
  lastSynced: SyncEntry | undefined
}): SyncAction {
  const { localBody, localHash, localUpdatedAt, remote, lastSynced } = params
  // Without any sync history, a blank day doesn't count as "changed" — a day
  // a pull point merely visits (boot, goToDay) shouldn't read as a local
  // edit just because nothing has ever been pushed for it.
  const localChanged = lastSynced ? lastSynced.hash !== localHash : localBody.trim() !== ''

  if (!remote) {
    return localChanged ? { kind: 'pushLocal' } : { kind: 'noop' }
  }

  const remoteChanged = !lastSynced || lastSynced.remoteUpdatedAt !== remote.updatedAt
  if (!localChanged && !remoteChanged) return { kind: 'noop' }
  if (localChanged && !remoteChanged) return { kind: 'pushLocal' }
  if (!localChanged && remoteChanged) return { kind: 'pullRemote', body: remote.body }

  // Both sides moved since they last agreed — a real conflict. The newer
  // side becomes the body; the older is never discarded, just appended
  // under a marker.
  const remoteTime = Date.parse(remote.updatedAt)
  if (remoteTime > localUpdatedAt) {
    return {
      kind: 'merge',
      body: `${remote.body}\n\n<!-- conflict: this device's version, ${new Date(localUpdatedAt).toISOString()} -->\n${localBody}`,
    }
  }
  return {
    kind: 'merge',
    body: `${localBody}\n\n<!-- conflict: a synced version from another device, ${new Date(remoteTime).toISOString()} -->\n${remote.body}`,
  }
}

export function createSyncedNoteStore(local: NoteStore, client: SupabaseClient): SyncedNoteStore {
  // Only identifies which device wrote a row, for debugging — nothing in
  // `decideSync` keys off it, so regenerating it every session (rather than
  // persisting it) costs nothing.
  const deviceId = crypto.randomUUID()

  async function readState(): Promise<SyncState> {
    const raw = await local.readSyncState()
    if (!raw) return {}
    try {
      return JSON.parse(raw) as SyncState
    } catch {
      // Corrupt sidecar — every day looks dirty, which is exactly the
      // self-healing behaviour a deleted sync.json gets. See docs/UPDATES.md §1.3.
      return {}
    }
  }

  const writeState = (state: SyncState) => local.writeSyncState(JSON.stringify(state))

  async function fetchRemote(day: DayKey): Promise<RemoteNote | null> {
    const { data, error } = await client
      .from('notes')
      .select('body, updated_at')
      .eq('day', day)
      .eq('slug', DAILY_NOTE_SLUG)
      .maybeSingle()
    if (error || !data) return null
    return { body: data.body as string, updatedAt: data.updated_at as string }
  }

  /** Upserts `body` for `day` and records the result in the sidecar. */
  async function push(day: DayKey, body: string): Promise<void> {
    try {
      const updatedAt = new Date().toISOString()
      const { error } = await client.from('notes').upsert({
        day,
        slug: DAILY_NOTE_SLUG,
        body,
        updated_at: updatedAt,
        device_id: deviceId,
      })
      if (error) return
      const state = await readState()
      state[day] = { remoteUpdatedAt: updatedAt, localUpdatedAt: Date.now(), hash: hashNote(body) }
      await writeState(state)
    } catch {
      // Offline, or the request otherwise failed. The sidecar is left
      // stale for this day, so the next pull's dirty check re-pushes it —
      // no separate offline queue needed.
    }
  }

  return {
    read: (day) => local.read(day),
    write: async (day, markdown) => {
      await local.write(day, markdown)
      void push(day, markdown)
    },
    listDaysWithNotes: () => local.listDaysWithNotes(),
    readSyncState: () => local.readSyncState(),
    writeSyncState: (contents) => local.writeSyncState(contents),

    async pull(day) {
      const [localBody, remote, state] = await Promise.all([
        local.read(day),
        fetchRemote(day),
        readState(),
      ])
      const lastSynced = state[day]
      const action = decideSync({
        localBody,
        localHash: hashNote(localBody),
        localUpdatedAt: lastSynced?.localUpdatedAt ?? 0,
        remote,
        lastSynced,
      })

      switch (action.kind) {
        case 'noop':
          return
        case 'pushLocal':
          await push(day, localBody)
          return
        case 'pullRemote':
          await local.write(day, action.body)
          state[day] = {
            remoteUpdatedAt: remote?.updatedAt ?? null,
            localUpdatedAt: Date.now(),
            hash: hashNote(action.body),
          }
          await writeState(state)
          return
        case 'merge':
          await local.write(day, action.body)
          await push(day, action.body)
          return
      }
    },
  }
}
