/**
 * A small Markdown parser for the note preview.
 *
 * Hand-rolled and deliberately partial, for the same reason `date.ts` is: the
 * supported subset is what someone actually writes in a daily note, it fits on
 * a screen, and it stays auditable. The alternative — a full CommonMark
 * implementation — is a large dependency for a feature that renders one short
 * document.
 *
 * It produces a tree of nodes, never an HTML string. The preview renders those
 * as React elements, so note text can't inject markup no matter what it says.
 * That matters more here than on the web: this runs inside a desktop shell with
 * `invoke` on the other side of the webview.
 *
 * Supported: ATX headings, paragraphs, fenced code, blockquotes, horizontal
 * rules, unordered and ordered lists, task-list checkboxes, and inline
 * emphasis, strong, strikethrough, code and links.
 *
 * Not supported, and rendered as plain text: nested lists, tables, setext
 * headings, reference links, images, raw HTML, footnotes.
 *
 * Emphasis is matched by delimiter pairs, not by CommonMark's delimiter-run
 * algorithm. `**bold**`, `*italic*` and `***both***` are right; a ragged
 * overlap like `**bold *and italic***` renders literally rather than being
 * guessed at. Resolving those properly means a delimiter stack, which is a lot
 * of machinery for a case that hardly occurs in a day's notes.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }

export interface ListItem {
  children: Inline[]
  /** Present only for `- [ ]` / `- [x]` items. */
  checked?: boolean
}

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'rule' }

const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s{0,3}```/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}\d+[.)]\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/

/**
 * Schemes a note may link to.
 *
 * Anything else — `javascript:` above all — is rendered as plain text. The
 * preview builds React elements rather than HTML, so this is a second line of
 * defence rather than the only one, but an anchor's `href` is executable in a
 * way element construction alone doesn't cover.
 */
const SAFE_SCHEME = /^(https?:|mailto:)/i

export function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (SAFE_SCHEME.test(trimmed)) return trimmed
  // A bare domain is the common case and is unambiguous enough to promote.
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

/*
 * Ordered so that longer delimiters win: `**` before `*`, `~~` before text.
 *
 * The link target allows one level of nested parentheses, so a URL that ends
 * in them — a Wikipedia article, most commonly — doesn't get truncated at its
 * first closing bracket. Arbitrary nesting isn't a thing regexes can do, and a
 * second level has never appeared in a real URL.
 */
const INLINE =
  /`([^`]+)`|\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)|\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\n]+?)\*|_([^_\n]+?)_/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text

  while (rest) {
    const match = INLINE.exec(rest)
    if (!match || match.index === undefined) break

    if (match.index > 0) out.push({ type: 'text', value: rest.slice(0, match.index) })

    const [whole, code, linkText, linkHref, both, strongA, strongB, strike, emA, emB] = match
    if (code !== undefined) {
      out.push({ type: 'code', value: code })
    } else if (both !== undefined) {
      out.push({ type: 'strong', children: [{ type: 'em', children: parseInline(both) }] })
    } else if (linkText !== undefined) {
      const href = safeHref(linkHref ?? '')
      // An unusable scheme degrades to the text the user wrote, rather than
      // silently vanishing.
      out.push(
        href
          ? { type: 'link', href, children: parseInline(linkText) }
          : { type: 'text', value: whole },
      )
    } else if (strongA !== undefined || strongB !== undefined) {
      out.push({ type: 'strong', children: parseInline((strongA ?? strongB) as string) })
    } else if (strike !== undefined) {
      out.push({ type: 'strike', children: parseInline(strike) })
    } else {
      out.push({ type: 'em', children: parseInline((emA ?? emB) as string) })
    }

    rest = rest.slice(match.index + whole.length)
  }

  if (rest) out.push({ type: 'text', value: rest })
  return out
}

function listItem(text: string): ListItem {
  const task = TASK.exec(text)
  if (task) {
    return { checked: task[1].toLowerCase() === 'x', children: parseInline(task[2]) }
  }
  return { children: parseInline(text) }
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    // Fenced code comes first: everything inside it is literal, including what
    // would otherwise look like a heading or a list.
    if (FENCE.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // closing fence, or the end of the note
      blocks.push({ type: 'code', value: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2]),
      })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1])
        i += 1
      }
      blocks.push({ type: 'quote', children: parseMarkdown(quoted.join('\n')) })
      continue
    }

    const ordered = ORDERED.test(line)
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? ORDERED : BULLET
      const items: ListItem[] = []
      // A switch between bullets and numbers starts a new list rather than
      // silently absorbing one into the other.
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(listItem((pattern.exec(lines[i]) as RegExpExecArray)[1]))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // Anything else is a paragraph, running until a blank line or the start of
    // some other block.
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  )
}
