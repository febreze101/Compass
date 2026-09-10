import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, type Block } from './markdown'

/** Flattens a tree back to its text, for asserting on content not shape. */
function textOf(nodes: { type: string; value?: string; children?: unknown[] }[]): string {
  return nodes
    .map((node) =>
      node.value !== undefined
        ? node.value
        : textOf((node.children ?? []) as Parameters<typeof textOf>[0]),
    )
    .join('')
}

describe('safeHref', () => {
  it('allows the schemes a note legitimately links to', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('promotes a bare www. domain', () => {
    expect(safeHref('www.example.com')).toBe('https://www.example.com')
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'tauri://localhost',
  ])('refuses %o', (url) => {
    // The preview builds React elements rather than HTML, so this is a second
    // line of defence — but an href is executable in a way element
    // construction alone is not.
    expect(safeHref(url)).toBeNull()
  })
})

describe('parseInline', () => {
  it('reads bold, italic, strikethrough and code', () => {
    expect(parseInline('**b**')[0]).toMatchObject({ type: 'strong' })
    expect(parseInline('__b__')[0]).toMatchObject({ type: 'strong' })
    expect(parseInline('*i*')[0]).toMatchObject({ type: 'em' })
    expect(parseInline('_i_')[0]).toMatchObject({ type: 'em' })
    expect(parseInline('~~s~~')[0]).toMatchObject({ type: 'strike' })
    expect(parseInline('`c`')[0]).toEqual({ type: 'code', value: 'c' })
  })

  it('prefers ** over * so bold does not read as nested italics', () => {
    const [node] = parseInline('**bold**')
    expect(node).toMatchObject({ type: 'strong' })
    expect(textOf([node])).toBe('bold')
  })

  it('leaves the text around a match intact', () => {
    expect(textOf(parseInline('a **b** c'))).toBe('a b c')
    expect(parseInline('a **b** c')).toHaveLength(3)
  })

  it('does not read markup inside a code span', () => {
    const [node] = parseInline('`**not bold**`')
    expect(node).toEqual({ type: 'code', value: '**not bold**' })
  })

  it('reads *** as bold and italic together', () => {
    const [node] = parseInline('***both***')
    expect(node).toMatchObject({ type: 'strong', children: [{ type: 'em' }] })
    expect(textOf([node])).toBe('both')
  })

  it('nests emphasis inside strong when the pairs are clean', () => {
    const [node] = parseInline('**bold and *italic* inside**')
    expect(node.type).toBe('strong')
    expect(textOf([node])).toBe('bold and italic inside')
  })

  it('leaves a ragged overlap literal rather than guessing', () => {
    // Resolving `**bold *and italic***` the way CommonMark does needs a
    // delimiter stack. The subset here renders it as written, which is wrong
    // but harmless — no text is lost or mangled.
    expect(textOf(parseInline('**bold *and italic***'))).toBe('bold *and italic*')
  })

  it('reads a link', () => {
    expect(parseInline('[docs](https://example.com)')[0]).toMatchObject({
      type: 'link',
      href: 'https://example.com',
    })
  })

  it('degrades an unsafe link to the text that was written', () => {
    // Dropping it silently would be worse: the user would not know why their
    // link vanished.
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { type: 'text', value: '[click](javascript:alert(1))' },
    ])
  })

  it('leaves unmatched delimiters as plain text', () => {
    expect(parseInline('2 * 3 * 4')).toContainEqual({ type: 'text', value: '2 ' })
    expect(textOf(parseInline('a ** b'))).toBe('a ** b')
  })

  it('handles text with no markup at all', () => {
    expect(parseInline('just words')).toEqual([{ type: 'text', value: 'just words' }])
  })
})

describe('parseMarkdown', () => {
  const kinds = (blocks: Block[]) => blocks.map((b) => b.type)

  it('reads headings at each level', () => {
    const blocks = parseMarkdown('# One\n### Three')
    expect(blocks).toMatchObject([
      { type: 'heading', level: 1 },
      { type: 'heading', level: 3 },
    ])
  })

  it('needs a space after the hashes', () => {
    expect(kinds(parseMarkdown('#nothashtag'))).toEqual(['paragraph'])
  })

  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    expect(kinds(parseMarkdown('one\ntwo\n\nthree'))).toEqual(['paragraph', 'paragraph'])
  })

  it('reads bullet and ordered lists', () => {
    expect(parseMarkdown('- a\n- b')).toMatchObject([
      { type: 'list', ordered: false, items: [{}, {}] },
    ])
    expect(parseMarkdown('1. a\n2. b')).toMatchObject([{ type: 'list', ordered: true }])
  })

  it('starts a new list when the marker style changes', () => {
    expect(kinds(parseMarkdown('- a\n1. b'))).toEqual(['list', 'list'])
  })

  it('reads task list checkboxes', () => {
    expect(parseMarkdown('- [ ] todo\n- [x] done')).toMatchObject([
      { type: 'list', items: [{ checked: false }, { checked: true }] },
    ])
  })

  it('treats an ordinary bullet as having no checkbox at all', () => {
    const [list] = parseMarkdown('- plain')
    expect(list).toMatchObject({ type: 'list' })
    expect((list as { items: { checked?: boolean }[] }).items[0].checked).toBeUndefined()
  })

  it('keeps fenced code literal', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```')
    expect(blocks).toEqual([{ type: 'code', value: '# not a heading\n- not a list' }])
  })

  it('closes an unterminated fence at the end of the note', () => {
    // Half-typed code blocks are normal while writing; the parser must not
    // spin or drop the rest of the document.
    expect(parseMarkdown('```\nstill typing')).toEqual([{ type: 'code', value: 'still typing' }])
  })

  it('reads blockquotes, including blocks inside them', () => {
    const [quote] = parseMarkdown('> # quoted heading\n> and text')
    expect(quote).toMatchObject({ type: 'quote' })
    expect(kinds((quote as { children: Block[] }).children)).toEqual(['heading', 'paragraph'])
  })

  it('reads horizontal rules without confusing them for list bullets', () => {
    expect(kinds(parseMarkdown('---'))).toEqual(['rule'])
    expect(kinds(parseMarkdown('***'))).toEqual(['rule'])
  })

  it('normalises CRLF, which is what a Windows editor writes', () => {
    expect(kinds(parseMarkdown('# a\r\n\r\nb'))).toEqual(['heading', 'paragraph'])
  })

  it('returns nothing for empty or blank input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n   \n')).toEqual([])
  })

  it('terminates on input that is only block markers', () => {
    // Guards the paragraph loop against never advancing.
    expect(() => parseMarkdown('>\n>\n-\n#')).not.toThrow()
  })

  it('reads a realistic note end to end', () => {
    const source = [
      '# Standup',
      '',
      'Talked to **Sam** about the [spec](https://example.com).',
      '',
      '- [x] ship the fix',
      '- [ ] write it up',
      '',
      '> blocked on the SDK',
    ].join('\n')

    expect(kinds(parseMarkdown(source))).toEqual([
      'heading',
      'paragraph',
      'list',
      'quote',
    ])
  })
})
