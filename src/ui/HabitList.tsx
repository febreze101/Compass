import { useState } from 'react'
import { useApp } from '../state/store'
import { monthlyCadence, weeklyCadence, type Habit } from '../lib/habits'

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

type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Add form for an evergreen task, with a cadence picker covering everything
 * `lib/habits.ts`'s grammar supports: daily, weekdays, every N weeks on any
 * combination of days (so "every other Tuesday" — garbage day — and "every
 * Monday and Thursday" are both one selection), and every N months on a day
 * of the month (quarterly is just "every 3 months").
 */
function AddHabitRow() {
  const addHabit = useApp((s) => s.addHabit)
  const today = new Date()

  const [title, setTitle] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [weekInterval, setWeekInterval] = useState(1)
  const [weekdays, setWeekdays] = useState<number[]>([today.getDay()])
  const [monthInterval, setMonthInterval] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(today.getDate())
  const [busy, setBusy] = useState(false)

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  function cadence(): string {
    switch (frequency) {
      case 'daily':
        return 'daily'
      case 'weekdays':
        return 'weekdays'
      case 'weekly':
        return weeklyCadence(weekInterval, weekdays.length ? weekdays : [today.getDay()])
      case 'monthly':
        return monthlyCadence(monthInterval, dayOfMonth)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy) return
    if (frequency === 'weekly' && weekdays.length === 0) return
    setBusy(true)
    const value = title
    const cad = cadence()
    setTitle('')
    try {
      await addHabit(value, cad)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="habit-add" onSubmit={(e) => void submit(e)}>
      <div className="row capture">
        <span className="capture__plus" aria-hidden="true">
          +
        </span>
        <input
          className="capture__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add something you do regularly"
          aria-label="Add an evergreen task"
        />
        <select
          className="habit-add__frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          aria-label="Repeats"
        >
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {frequency === 'weekly' && (
        <div className="habit-add__detail">
          <label className="habit-add__interval">
            Every
            <input
              type="number"
              min={1}
              className="habit-add__number"
              value={weekInterval}
              onChange={(e) => setWeekInterval(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Number of weeks"
            />
            week(s) on
          </label>
          <div className="habit-add__weekdays">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                className={`habit-add__day${weekdays.includes(day) ? ' habit-add__day--on' : ''}`}
                onClick={() => toggleWeekday(day)}
                aria-pressed={weekdays.includes(day)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {frequency === 'monthly' && (
        <div className="habit-add__detail">
          <label className="habit-add__interval">
            Every
            <input
              type="number"
              min={1}
              className="habit-add__number"
              value={monthInterval}
              onChange={(e) => setMonthInterval(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Number of months"
            />
            month(s) on day
            <input
              type="number"
              min={1}
              max={31}
              className="habit-add__number"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
              aria-label="Day of month"
            />
          </label>
        </div>
      )}
    </form>
  )
}

/**
 * Evergreen tasks (docs/UPDATES.md §2) — things done on a recurring cadence
 * rather than due on one day. Compass owns these outright; Google Tasks
 * never sees them (§2.2), so this section has nothing to do with the
 * Sources task-list selection above it and stays put regardless of what's
 * toggled there.
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
