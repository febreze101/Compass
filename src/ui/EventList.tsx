import { useState } from 'react'
import type { Calendar, CalendarEvent } from '../lib/google/types'
import { EventEditor } from './EventEditor'

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function timeLabel(event: CalendarEvent): string {
  if (event.allDay) return 'All day'
  const start = TIME.format(event.start)
  const end = TIME.format(event.end)
  return start === end ? start : `${start} – ${end}`
}

const keyOf = (event: CalendarEvent) => `${event.calendarId}:${event.id}`

export function EventList({
  events,
  calendars,
}: {
  events: CalendarEvent[]
  calendars: Calendar[]
}) {
  const [editing, setEditing] = useState<string | null>(null)

  const calendarOf = (id: string) => calendars.find((c) => c.id === id)

  return (
    <section className="section">
      <h2 className="section__title">Schedule</h2>
      <div className="card">
        {events.length === 0 ? (
          <p className="empty">Nothing scheduled.</p>
        ) : (
          events.map((event) => {
            const key = keyOf(event)
            if (editing === key) {
              return <EventEditor key={key} event={event} onClose={() => setEditing(null)} />
            }

            // Subscribed feeds and other people's calendars come back read-only,
            // and Google rejects writes to them. Offering an editor that could
            // only fail is worse than not offering one.
            const editable = !calendarOf(event.calendarId)?.readOnly
            const color = calendarOf(event.calendarId)?.backgroundColor

            return (
              <div
                className={`row${editable ? ' row--editable' : ''}`}
                key={key}
                role={editable ? 'button' : undefined}
                tabIndex={editable ? 0 : undefined}
                onClick={editable ? () => setEditing(key) : undefined}
                onKeyDown={
                  editable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setEditing(key)
                        }
                      }
                    : undefined
                }
              >
                <span
                  className="swatch"
                  style={color ? { background: color } : undefined}
                  aria-hidden="true"
                />
                <span className="row__time">{timeLabel(event)}</span>
                <span className="row__body">
                  <span className="row__title">{event.title}</span>
                  {event.location && <span className="row__meta">{event.location}</span>}
                </span>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
