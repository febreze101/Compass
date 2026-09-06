import type { ReactNode } from 'react'
import type { Block, Inline } from '../lib/markdown'

/**
 * Renders the parsed note.
 *
 * Everything here is built as React elements — no `dangerouslySetInnerHTML`
 * anywhere — so text in a note is text, whatever it contains. Keys are indices
 * because the tree is rebuilt wholesale on every edit; there is nothing with an
 * identity to preserve.
 */

function inlines(nodes: Inline[], onOpenLink: (href: string) => void): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <span key={index}>{node.value}</span>
      case 'strong':
        return <strong key={index}>{inlines(node.children, onOpenLink)}</strong>
      case 'em':
        return <em key={index}>{inlines(node.children, onOpenLink)}</em>
      case 'strike':
        return <s key={index}>{inlines(node.children, onOpenLink)}</s>
      case 'code':
        return (
          <code key={index} className="md__code">
            {node.value}
          </code>
        )
      case 'link':
        return (
          <a
            key={index}
            className="md__link"
            href={node.href}
            // Handled rather than followed: a link inside the webview would
            // navigate the app away from itself.
            onClick={(e) => {
              e.preventDefault()
              onOpenLink(node.href)
            }}
          >
            {inlines(node.children, onOpenLink)}
          </a>
        )
    }
  })
}

function block(node: Block, index: number, onOpenLink: (href: string) => void): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = `h${Math.min(node.level + 2, 6)}` as 'h3'
      // Shifted down two levels: the page's <h1> is the date and the section
      // titles are <h2>, so a note's "#" is a sub-heading of the note itself.
      return (
        <Tag key={index} className="md__heading">
          {inlines(node.children, onOpenLink)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={index} className="md__p">
          {inlines(node.children, onOpenLink)}
        </p>
      )
    case 'code':
      return (
        <pre key={index} className="md__pre">
          <code>{node.value}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote key={index} className="md__quote">
          {node.children.map((child, i) => block(child, i, onOpenLink))}
        </blockquote>
      )
    case 'rule':
      return <hr key={index} className="md__rule" />
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul'
      return (
        <Tag key={index} className="md__list">
          {node.items.map((item, i) => (
            <li key={i} className={item.checked === undefined ? undefined : 'md__task'}>
              {item.checked !== undefined && (
                // Display only. Ticking it here would have to rewrite the
                // source text, and the note is edited on the Write tab.
                <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
              )}
              {inlines(item.children, onOpenLink)}
            </li>
          ))}
        </Tag>
      )
    }
  }
}

export function Markdown({
  blocks,
  onOpenLink,
}: {
  blocks: Block[]
  onOpenLink: (href: string) => void
}) {
  return <div className="md">{blocks.map((node, i) => block(node, i, onOpenLink))}</div>
}
