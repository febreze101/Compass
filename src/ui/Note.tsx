import { useEffect, useRef } from 'react'
import { useApp } from '../state/store'

/**
 * The day's note: one Markdown document per calendar day, autosaved.
 *
 * Deliberately a plain textarea. The note is a real `.md` file the user can
 * open in any editor (docs/SCOPE.md §8.4), and a rich-text surface would either
 * lie about what's stored or start owning a format Compass has no business
 * owning.
 */
export function Note() {
  const note = useApp((s) => s.note)
  const noteLoading = useApp((s) => s.noteLoading)
  const noteSaving = useApp((s) => s.noteSaving)
  const editNote = useApp((s) => s.editNote)
  const flushNote = useApp((s) => s.flushNote)

  const box = useRef<HTMLTextAreaElement>(null)

  // Grows with its content: a note is a document, and an inner scrollbar in the
  // middle of a page that already scrolls is a trap.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note])

  return (
    <section className="section">
      <h2 className="section__title">
        Note
        {/* Only ever shown while a write is genuinely in flight — a permanent
            "Saved" badge is noise that stops meaning anything. */}
        {noteSaving && <span className="section__status">Saving…</span>}
      </h2>
      <div className="card">
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
      </div>
    </section>
  )
}
