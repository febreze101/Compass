import { addDays, parseDayKey, todayKey, type DayKey } from '../lib/date'

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const LONG_DATE = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' })
const WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export function DayBar({ day, onChange }: { day: DayKey; onChange: (day: DayKey) => void }) {
  const date = parseDayKey(day)
  const today = todayKey()
  // The year is noise for nearby dates and essential once you've navigated far.
  const sameYear = parseDayKey(today).getFullYear() === date.getFullYear()

  return (
    <header className="daybar">
      <h1 className="daybar__date">
        <span className="daybar__weekday">
          {day === today ? 'Today' : WEEKDAY.format(date)}
        </span>
        {(sameYear ? LONG_DATE : WITH_YEAR).format(date)}
      </h1>

      <div className="daybar__nav">
        <button
          className="iconbutton"
          onClick={() => onChange(addDays(day, -1))}
          aria-label="Previous day"
        >
          ‹
        </button>
        {day !== today && (
          <button className="textbutton" onClick={() => onChange(today)}>
            Today
          </button>
        )}
        <button
          className="iconbutton"
          onClick={() => onChange(addDays(day, 1))}
          aria-label="Next day"
        >
          ›
        </button>
      </div>
    </header>
  )
}
