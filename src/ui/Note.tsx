import { useEffect, useMemo, useRef, useState } from 'react'
import { parseMarkdown } from '../lib/markdown'
import { useApp } from '../state/store'
import { Markdown } from './Markdown'

/**
 * The day's note: one Markdown document per calendar day, autosaved.
 *
 * Two views of the same text rather than a rich-text editor. What's on disk is
 * a plain `.md` file the user can open anywhere (docs/SCOPE.md §8.4), and
 * editing formatted output in place would mean owning a document model that
 * has to round-trip back to Markdown without drift. Write shows the source;
 * Preview shows what it means.
 */
export function Note() {
  const note = useApp((s) => s.note)
  const noteLoading = useApp((s) => s.noteLoading)
  const noteSaving = useApp((s) => s.noteSaving)
  const editNote = useApp((s) => s.editNote)
  const flushNote = useApp((s) => s.flushNote)
  const openLink = useApp((s) => s.openLink)

  const [preview, setPreview] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  // Only re-parsed when the text changes, not on every unrelated render.
  const blocks = useMemo(() => (preview ? parseMarkdown(note) : []), [preview, note])

  // Grows with its content: a note is a document, and an inner scrollbar in the
  // middle of a page that already scrolls is a trap.
  useEffect(() => {
    const el = box.current
    if (!el || preview) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note, preview])

  return (
    <section className="section">
      <h2 className="section__title">
        Note
        {/* Only while a write is genuinely in flight — a permanent "Saved"
            badge is noise that stops meaning anything. */}
        {noteSaving && <span className="section__status">Saving…</span>}
        <span className="tabs">
          <button
            type="button"
            className={`tab${preview ? '' : ' tab--on'}`}
            onClick={() => setPreview(false)}
            aria-pressed={!preview}
          >
            Write
          </button>
          <button
            type="button"
            className={`tab${preview ? ' tab--on' : ''}`}
            // Flushed on the way in, so what's previewed is what's on disk.
            onClick={() => {
              void flushNote()
              setPreview(true)
            }}
            aria-pressed={preview}
          >
            Preview
          </button>
        </span>
      </h2>

      <div className="card">
        {preview ? (
          note.trim() ? (
            <div className="note note--preview">
              <Markdown blocks={blocks} onOpenLink={openLink} />
            </div>
          ) : (
            <p className="empty">Nothing written for this day.</p>
          )
        ) : (
          <textarea
            ref={box}
            className="note"
            value={note}
            onChange={(e) => editNote(e.target.value)}
            onBlur={() => void flushNote()}
            placeholder={noteLoading ? '' : 'Anything worth remembering about today…'}
            aria-label="Note for this day"
            rows={4}
          />
        )}
      </div>
    </section>
  )
}
