import { useApp } from '../state/store'
import { Capture } from './Capture'
import { DayBar } from './DayBar'
import { EventList } from './EventList'
import { SourcePicker } from './SourcePicker'
import { TaskList } from './TaskList'

export function TodayPage() {
  const day = useApp((s) => s.day)
  const goToDay = useApp((s) => s.goToDay)
  const events = useApp((s) => s.events)
  const tasks = useApp((s) => s.tasks)
  const undated = useApp((s) => s.undated)
  const calendars = useApp((s) => s.calendars)
  const taskLists = useApp((s) => s.taskLists)

  return (
    <main className="shell">
      <DayBar day={day} onChange={(next) => void goToDay(next)} />

      <EventList events={events} calendars={calendars} />

      <TaskList title="Tasks" tasks={tasks} lists={taskLists} emptyLabel="Nothing due today." />

      {/* Tasks Google holds with no date. Compass always sets one, but tasks
          made in Google's own apps may not have it — without this they would
          be invisible here. See docs/SCOPE.md §8.8. */}
      {undated.length > 0 && (
        <TaskList
          title="No date"
          tasks={undated}
          lists={taskLists}
          emptyLabel=""
        />
      )}

      <Capture />

      <SourcePicker />
    </main>
  )
}
