import { useState } from 'react'
import { useApp } from '../state/store'

/**
 * One box for adding anything to the day.
 *
 * Give it a time and it creates a calendar event; leave the time blank and it
 * creates a task. That isn't an interface flourish — it's the only honest model
 * available, because Google Tasks cannot store a time at all (docs/SCOPE.md
 * §7, §8.6). The rule itself lives in `lib/capture.ts`.
 */
export function Capture() {
  const capture = useApp((s) => s.capture)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy) return

    setBusy(true)
    const entry = { title, time }
    // Cleared before the round trip: the common case is adding several in a
    // row, and waiting to type the next one is the wrong feel.
    setTitle('')
    setTime('')
    try {
      await capture(entry)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section">
      <h2 className="section__title">Add</h2>
      <div className="card">
        <form className="row capture" onSubmit={(e) => void submit(e)}>
          <span className="capture__plus" aria-hidden="true">
            +
          </span>
          <input
            className="capture__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task or event"
            aria-label="Add a task or event"
          />
          <input
            type="time"
            className="capture__time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time (makes it an event)"
          />
        </form>
      </div>
      <p className="hint">
        {time ? 'Adds an event at that time.' : 'Add a time to make it an event instead of a task.'}
      </p>
    </section>
  )
}
