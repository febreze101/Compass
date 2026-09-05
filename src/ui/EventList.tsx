import type { Calendar, CalendarEvent } from '../lib/google/types'

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function timeLabel(event: CalendarEvent): string {
  if (event.allDay) return 'All day'
  const start = TIME.format(event.start)
  const end = TIME.format(event.end)
  return start === end ? start : `${start} – ${end}`
}

export function EventList({
  events,
  calendars,
}: {
  events: CalendarEvent[]
  calendars: Calendar[]
}) {
  const colorOf = (calendarId: string) =>
    calendars.find((c) => c.id === calendarId)?.backgroundColor

  return (
    <section className="section">
      <h2 className="section__title">Schedule</h2>
      <div className="card">
        {events.length === 0 ? (
          <p className="empty">Nothing scheduled.</p>
        ) : (
          events.map((event) => (
            <div className="row" key={`${event.calendarId}:${event.id}`}>
              <span
                className="swatch"
                style={colorOf(event.calendarId) ? { background: colorOf(event.calendarId) } : undefined}
                aria-hidden="true"
              />
              <span className="row__time">{timeLabel(event)}</span>
              <span className="row__body">
                <span className="row__title">{event.title}</span>
                {event.location && <span className="row__meta">{event.location}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
