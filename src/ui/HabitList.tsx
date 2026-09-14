import { useState } from 'react'
import { useApp } from '../state/store'
import type { Habit } from '../lib/habits'

function HabitRow({ habit, done }: { habit: Habit; done: boolean }) {
  const toggleHabit = useApp((s) => s.toggleHabit)

  return (
    <label className={`row task${done ? ' task--done' : ''}`}>
      <input
        className="task__box"
        type="checkbox"
        checked={done}
        onChange={() => void toggleHabit(habit.id)}
      />
      <span className="row__body">
        <span className="row__title">{habit.title}</span>
      </span>
    </label>
  )
}

/** Same shape as Capture.tsx's inline form — one field, no separate screen. */
function AddHabitRow() {
  const addHabit = useApp((s) => s.addHabit)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    const value = title
    setTitle('')
    try {
      await addHabit(value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="row capture" onSubmit={(e) => void submit(e)}>
      <span className="capture__plus" aria-hidden="true">
        +
      </span>
      <input
        className="capture__input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add something you do every day"
        aria-label="Add an evergreen task"
      />
    </form>
  )
}

/**
 * Evergreen tasks (docs/UPDATES.md §2) — things done every day rather than
 * due on one. Compass owns these outright; Google Tasks never sees them
 * (§2.2), so this section has nothing to do with the Sources task-list
 * selection above it and stays put regardless of what's toggled there.
 *
 * Every habit created here is `daily` — cadence-picking (weekdays, a
 * specific weekday) is supported by `habitsForDay` but not yet exposed in
 * the UI; not worth building ahead of §6's design pass.
 */
export function HabitList({ habits, habitLog }: { habits: Habit[]; habitLog: string[] }) {
  return (
    <section className="section">
      <h2 className="section__title">Every day</h2>
      <div className="card">
        {habits.length === 0 && <p className="empty">Nothing set up yet.</p>}
        {habits.map((habit) => (
          <HabitRow key={habit.id} habit={habit} done={habitLog.includes(habit.id)} />
        ))}
        <AddHabitRow />
      </div>
    </section>
  )
}
