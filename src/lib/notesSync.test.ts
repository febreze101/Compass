import { describe, expect, it, vi } from 'vitest'
import { createSyncedNoteStore, decideSync, hashNote } from './notesSync'
import type { NoteStore } from '../platform/types'

describe('hashNote', () => {
  it('is stable for the same text', () => {
    expect(hashNote('hello')).toBe(hashNote('hello'))
  })

  it('differs when the text differs', () => {
    expect(hashNote('hello')).not.toBe(hashNote('hello!'))
  })
})

describe('decideSync', () => {
  const base = { localBody: '', localHash: hashNote(''), localUpdatedAt: 0, remote: null, lastSynced: undefined }

  it('does nothing for an empty day with no remote row', () => {
    expect(decideSync(base)).toEqual({ kind: 'noop' })
  })

  it('pushes a fresh local note that has no remote row yet', () => {
    expect(decideSync({ ...base, localBody: 'hello', localHash: hashNote('hello') })).toEqual({
      kind: 'pushLocal',
    })
  })

  it('does nothing when local and remote both match the last sync', () => {
    const hash = hashNote('same')
    expect(
      decideSync({
        localBody: 'same',
        localHash: hash,
        localUpdatedAt: 1000,
        remote: { body: 'same', updatedAt: '2026-09-10T00:00:00.000Z' },
        lastSynced: { remoteUpdatedAt: '2026-09-10T00:00:00.000Z', localUpdatedAt: 1000, hash },
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('pushes when only the local copy changed since the last sync', () => {
    expect(
      decideSync({
        localBody: 'edited',
        localHash: hashNote('edited'),
        localUpdatedAt: 2000,
        remote: { body: 'old', updatedAt: '2026-09-10T00:00:00.000Z' },
        lastSynced: {
          remoteUpdatedAt: '2026-09-10T00:00:00.000Z',
          localUpdatedAt: 1000,
          hash: hashNote('old'),
        },
      }),
    ).toEqual({ kind: 'pushLocal' })
  })

  it('pulls cleanly into a day that was only ever visited, never written to', () => {
    // No lastSynced entry and a blank local body — a day a pull point merely
    // looked at, not a local edit — must not read as "both sides changed"
    // and get wrapped in a spurious conflict block.
    expect(
      decideSync({
        localBody: '',
        localHash: hashNote(''),
        localUpdatedAt: 0,
        remote: { body: 'written on the other device', updatedAt: '2026-09-10T00:00:00.000Z' },
        lastSynced: undefined,
      }),
    ).toEqual({ kind: 'pullRemote', body: 'written on the other device' })
  })

  it('pulls when only the remote copy changed since the last sync', () => {
    expect(
      decideSync({
        localBody: 'old',
        localHash: hashNote('old'),
        localUpdatedAt: 1000,
        remote: { body: 'from another device', updatedAt: '2026-09-11T00:00:00.000Z' },
        lastSynced: {
          remoteUpdatedAt: '2026-09-10T00:00:00.000Z',
          localUpdatedAt: 1000,
          hash: hashNote('old'),
        },
      }),
    ).toEqual({ kind: 'pullRemote', body: 'from another device' })
  })

  it('merges a real conflict, keeping the losing text rather than dropping it', () => {
    // Both sides changed since they last agreed. Remote is newer here, so it
    // wins the body; the local edit is preserved underneath, not discarded.
    const action = decideSync({
      localBody: 'my local edit',
      localHash: hashNote('my local edit'),
      localUpdatedAt: 1000,
      remote: { body: 'their remote edit', updatedAt: new Date(2000).toISOString() },
      lastSynced: { remoteUpdatedAt: 'old-stamp', localUpdatedAt: 500, hash: hashNote('base') },
    })
    expect(action.kind).toBe('merge')
    if (action.kind === 'merge') {
      expect(action.body).toContain('their remote edit')
      expect(action.body).toContain('my local edit')
      expect(action.body).toContain('<!-- conflict:')
      // The winning body leads, so opening the note shows the newer text first.
      expect(action.body.indexOf('their remote edit')).toBeLessThan(action.body.indexOf('my local edit'))
    }
  })

  it('keeps the local edit on top when local is the newer side of a conflict', () => {
    const action = decideSync({
      localBody: 'my newer local edit',
      localHash: hashNote('my newer local edit'),
      localUpdatedAt: 5000,
      remote: { body: 'their older remote edit', updatedAt: new Date(2000).toISOString() },
      lastSynced: { remoteUpdatedAt: 'old-stamp', localUpdatedAt: 500, hash: hashNote('base') },
    })
    expect(action.kind).toBe('merge')
    if (action.kind === 'merge') {
      expect(action.body.indexOf('my newer local edit')).toBeLessThan(
        action.body.indexOf('their older remote edit'),
      )
    }
  })
})

/** A NoteStore backed by an in-memory map, for exercising the decorator. */
function fakeLocalStore(): NoteStore & { files: Map<string, string> } {
  const files = new Map<string, string>()
  let syncState: string | null = null
  return {
    files,
    async read(day) {
      return files.get(day) ?? ''
    },
    async write(day, markdown) {
      if (markdown.trim()) files.set(day, markdown)
      else files.delete(day)
    },
    async listDaysWithNotes() {
      return [...files.keys()].sort()
    },
    async readSyncState() {
      return syncState
    },
    async writeSyncState(contents) {
      syncState = contents
    },
  }
}

/** A minimal Supabase stand-in covering just the `notes` table calls this module makes. */
function fakeSupabase(rows: Map<string, { body: string; updated_at: string }>) {
  const upserts: { day: string; body: string }[] = []
  const client = {
    from: () => ({
      select: () => ({
        eq: (_col: string, day: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              const row = rows.get(day)
              return { data: row ?? null, error: null }
            },
          }),
        }),
      }),
      upsert: async (row: { day: string; body: string; updated_at: string }) => {
        upserts.push({ day: row.day, body: row.body })
        rows.set(row.day, { body: row.body, updated_at: row.updated_at })
        return { error: null }
      },
    }),
  }
  return { client: client as unknown as import('@supabase/supabase-js').SupabaseClient, upserts }
}

describe('createSyncedNoteStore', () => {
  it('read/write/listDaysWithNotes pass straight through to the local store', async () => {
    const local = fakeLocalStore()
    const { client } = fakeSupabase(new Map())
    const store = createSyncedNoteStore(local, client)

    await store.write('2026-09-10', 'hello')
    expect(await store.read('2026-09-10')).toBe('hello')
    expect(await store.listDaysWithNotes()).toEqual(['2026-09-10'])
  })

  it('pushes a local write to Supabase in the background', async () => {
    const local = fakeLocalStore()
    const { client, upserts } = fakeSupabase(new Map())
    const store = createSyncedNoteStore(local, client)

    await store.write('2026-09-10', 'hello world')
    // The push is fire-and-forget; give its microtasks a turn.
    await vi.waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0]).toMatchObject({ day: '2026-09-10', body: 'hello world' })
  })

  it('pull() brings down a remote note the local device has never seen', async () => {
    const local = fakeLocalStore()
    const rows = new Map([['2026-09-10', { body: 'written on the other device', updated_at: new Date().toISOString() }]])
    const { client } = fakeSupabase(rows)
    const store = createSyncedNoteStore(local, client)

    await store.pull('2026-09-10')
    expect(await store.read('2026-09-10')).toBe('written on the other device')
  })

  it('pull() leaves an untouched day alone', async () => {
    const local = fakeLocalStore()
    const { client, upserts } = fakeSupabase(new Map())
    const store = createSyncedNoteStore(local, client)

    await store.pull('2026-09-10')
    expect(await store.read('2026-09-10')).toBe('')
    expect(upserts).toHaveLength(0)
  })
})
