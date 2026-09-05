import { useApp } from '../state/store'

export function SourcePicker() {
  const calendars = useApp((s) => s.calendars)
  const taskLists = useApp((s) => s.taskLists)
  const selectedCalendarIds = useApp((s) => s.selectedCalendarIds)
  const selectedTaskListIds = useApp((s) => s.selectedTaskListIds)
  const toggleCalendar = useApp((s) => s.toggleCalendar)
  const toggleTaskList = useApp((s) => s.toggleTaskList)
  const disconnect = useApp((s) => s.disconnect)

  return (
    <details className="sources">
      <summary className="sources__summary">Sources</summary>

      <div className="sources__group">
        <h3 className="section__title">Calendars</h3>
        {calendars.map((calendar) => (
          <label className="sources__label" key={calendar.id}>
            <input
              type="checkbox"
              checked={selectedCalendarIds.includes(calendar.id)}
              onChange={() => void toggleCalendar(calendar.id)}
            />
            <span
              className="dot"
              style={calendar.backgroundColor ? { background: calendar.backgroundColor } : undefined}
              aria-hidden="true"
            />
            {calendar.title}
          </label>
        ))}
      </div>

      <div className="sources__group">
        <h3 className="section__title">Task lists</h3>
        {taskLists.map((list) => (
          <label className="sources__label" key={list.id}>
            <input
              type="checkbox"
              checked={selectedTaskListIds.includes(list.id)}
              onChange={() => void toggleTaskList(list.id)}
            />
            {list.title}
          </label>
        ))}
      </div>

      <div className="sources__footer">
        <span>Signed in to Google</span>
        <button className="textbutton" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    </details>
  )
}
