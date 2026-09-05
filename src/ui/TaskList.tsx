import type { TaskItem, TaskList as TaskListModel } from '../lib/google/types'

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
  const nameOf = (listId: string) => lists.find((l) => l.id === listId)?.title

  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="card">
        {tasks.length === 0 ? (
          <p className="empty">{emptyLabel}</p>
        ) : (
          tasks.map((task) => (
            <div className={`row task${task.completed ? ' task--done' : ''}`} key={task.id}>
              {/* Read-only until M2 wires completion back to Google — a checkbox
                  that silently forgot its state would be worse than none. */}
              <input
                className="task__box"
                type="checkbox"
                checked={task.completed}
                disabled
                readOnly
                aria-label={task.title}
              />
              <span className="row__body">
                <span className="row__title">{task.title}</span>
                {(task.notes || (showListName && nameOf(task.listId))) && (
                  <span className="row__meta">
                    {[showListName ? nameOf(task.listId) : null, task.notes]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
