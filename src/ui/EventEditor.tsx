import { useState } from 'react'
import { draftFromEvent, type EventDraft } from '../lib/google/calendar'
import type { CalendarEvent } from '../lib/google/types'
import { useApp } from '../state/store'

/**
 * Edits one event in place, where its row was.
 *
 * An inline panel rather than a modal: the page is a single column the user is
 * already reading down, and a dialog over it would hide the day it belongs to.
 *
 * Clearing both times makes the event all-day, which is the same rule the
 * capture box uses in the other direction — no time means no time.
 */
export function EventEditor({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const saveEvent = useApp((s) => s.saveEvent)
  const removeEvent = useApp((s) => s.removeEvent)

  const [draft, setDraft] = useState<EventDraft>(() => draftFromEvent(event))
  const [busy, setBusy] = useState(false)

  const change = (patch: Partial<EventDraft>) => setDraft((current) => ({ ...current, ...patch }))

  /** Closes only when the write landed, so a failure keeps the edits on screen. */
  async function run(action: () => Promise<boolean>) {
    if (busy) return
    setBusy(true)
    try {
      if (await action()) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="row editor"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => saveEvent(event, draft))
      }}
      // Escape is the expected way out of an inline edit, and it costs nothing.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <input
        className="editor__title"
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
        placeholder="Title"
        aria-label="Title"
        autoFocus
      />

      <div className="editor__times">
        <input
          type="time"
          className="editor__field"
          value={draft.startTime ?? ''}
          onChange={(e) => change({ startTime: e.target.value || undefined })}
          aria-label="Start time"
        />
        <span className="editor__dash" aria-hidden="true">
          –
        </span>
        <input
          type="time"
          className="editor__field"
          value={draft.endTime ?? ''}
          onChange={(e) => change({ endTime: e.target.value || undefined })}
          aria-label="End time"
        />
        {!draft.startTime && <span className="editor__note">All day</span>}
      </div>

      <input
        className="editor__field editor__location"
        value={draft.location ?? ''}
        onChange={(e) => change({ location: e.target.value })}
        placeholder="Location"
        aria-label="Location"
      />

      {event.recurring && (
        // Compass edits the occurrence, never the series — docs/SCOPE.md §7.
        <p className="editor__note">This event repeats. Changes apply to this day only.</p>
      )}

      <div className="editor__actions">
        <button type="submit" className="button-primary button-small" disabled={busy}>
          Save
        </button>
        <button type="button" className="textbutton" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="textbutton textbutton--danger"
          onClick={() => void run(() => removeEvent(event))}
          disabled={busy}
        >
          Delete
        </button>
      </div>
    </form>
  )
}
