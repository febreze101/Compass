import { describe, expect, it } from 'vitest'
import { searchNotes } from './notesSearch'

function fakeSupabase(rows: { day: string; slug: string }[]) {
  const calls: { pattern: string }[] = []
  const client = {
    from: () => ({
      select: () => ({
        ilike: (_col: string, pattern: string) => {
          calls.push({ pattern })
          return {
            order: () => ({
              limit: async () => ({ data: rows, error: null }),
            }),
          }
        },
      }),
    }),
  }
  return { client: client as unknown as import('@supabase/supabase-js').SupabaseClient, calls }
}

describe('searchNotes', () => {
  it('returns nothing for a query shorter than the minimum length', async () => {
    const { client, calls } = fakeSupabase([{ day: '2026-09-10', slug: '' }])
    expect(await searchNotes(client, 'ab')).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('wraps the trimmed query in wildcards for an ILIKE search', async () => {
    const { client, calls } = fakeSupabase([])
    await searchNotes(client, '  dentist  ')
    expect(calls[0].pattern).toBe('%dentist%')
  })

  it('returns the matching days', async () => {
    const { client } = fakeSupabase([
      { day: '2026-09-10', slug: '' },
      { day: '2026-08-01', slug: '' },
    ])
    expect(await searchNotes(client, 'dentist')).toEqual([
      { day: '2026-09-10', slug: '' },
      { day: '2026-08-01', slug: '' },
    ])
  })
})
