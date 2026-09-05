import { describe, expect, it } from 'vitest'
import { resolveSelection } from './prefs'

describe('resolveSelection', () => {
  it('selects everything the first time, when nothing is saved', () => {
    expect(resolveSelection(['a', 'b'], null)).toEqual(['a', 'b'])
  })

  it('keeps the saved choice', () => {
    expect(resolveSelection(['a', 'b', 'c'], { selected: ['a', 'c'], known: ['a', 'b', 'c'] })).toEqual(
      ['a', 'c'],
    )
  })

  it('opts genuinely new sources in, so a calendar added in Google shows up', () => {
    // `known` is what makes this possible: without it, a source that is new and
    // one the user deliberately unchecked look identical.
    expect(resolveSelection(['a', 'b', 'new'], { selected: ['a'], known: ['a', 'b'] })).toEqual([
      'a',
      'new',
    ])
  })

  it('leaves a deliberately unchecked source unchecked', () => {
    expect(resolveSelection(['a', 'b'], { selected: ['a'], known: ['a', 'b'] })).toEqual(['a'])
  })

  it('drops saved ids that no longer exist', () => {
    expect(resolveSelection(['a'], { selected: ['a', 'deleted'], known: ['a', 'deleted'] })).toEqual([
      'a',
    ])
  })

  it('honours an explicitly empty selection rather than re-selecting everything', () => {
    // Unchecking every source is a real choice, not an absent one.
    expect(resolveSelection(['a', 'b'], { selected: [], known: ['a', 'b'] })).toEqual([])
  })

  it('preserves the order the sources arrive in', () => {
    expect(
      resolveSelection(['x', 'y', 'z'], { selected: ['z', 'x'], known: ['x', 'y', 'z'] }),
    ).toEqual(['x', 'z'])
  })
})
