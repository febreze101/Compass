import { useApp } from '../state/store'
import type { TaskItem, TaskList as TaskListModel } from '../lib/google/types'

function TaskRow({ task, showListName, listName }: {
  task: TaskItem
  showListName: boolean
  listName?: string
}) {
  const toggleTask = useApp((s) => s.toggleTask)
  const meta = [showListName ? listName : null, task.notes].filter(Boolean).join(' · ')

  return (
    <label className={`row task${task.completed ? ' task--done' : ''}`}>
      <input
        className="task__box"
        type="checkbox"
        checked={task.completed}
        onChange={() => void toggleTask(task)}
      />
      <span className="row__body">
        <span className="row__title">{task.title}</span>
        {meta && <span className="row__meta">{meta}</span>}
      </span>
    </label>
  )
}

export function TaskList({
  title,
  tasks,
  lists,
  emptyLabel,
}: {
  title: string
  tasks: TaskItem[]
  lists: TaskListModel[]
  emptyLabel: string
}) {
  // The list name only earns its place when more than one list is in play.
  const showListName = lists.length > 1

  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="card">
        {tasks.length === 0 && <p className="empty">{emptyLabel}</p>}
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showListName={showListName}
            listName={lists.find((l) => l.id === task.listId)?.title}
          />
        ))}
      </div>
    </section>
  )
}
