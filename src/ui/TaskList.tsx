import { useApp } from '../state/store'
import type { TaskItem, TaskList as TaskListModel } from '../lib/google/types'

function TaskRow({
  task,
  showListName,
  listName,
  reorder,
}: {
  task: TaskItem
  showListName: boolean
  listName?: string
  /** Present only on the reorderable (due-today) list — see TaskList below. */
  reorder?: { canMoveUp: boolean; canMoveDown: boolean }
}) {
  const toggleTask = useApp((s) => s.toggleTask)
  const moveTask = useApp((s) => s.moveTask)
  const meta = [showListName ? listName : null, task.notes].filter(Boolean).join(' · ')

  return (
    <div className={`row task${task.completed ? ' task--done' : ''}`}>
      {/* Its own element, not wrapping the reorder buttons too — a <label>
          forwards any click inside it to the checkbox, which would toggle
          the task every time someone tapped "move up". */}
      <label className="task__label">
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
      {reorder && (
        <span className="task__reorder">
          <button
            type="button"
            className="iconbutton"
            disabled={!reorder.canMoveUp}
            onClick={() => void moveTask(task.id, 'up')}
            aria-label={`Move ${task.title} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="iconbutton"
            disabled={!reorder.canMoveDown}
            onClick={() => void moveTask(task.id, 'down')}
            aria-label={`Move ${task.title} down`}
          >
            ↓
          </button>
        </span>
      )}
    </div>
  )
}

export function TaskList({
  title,
  tasks,
  lists,
  emptyLabel,
  reorderable = false,
}: {
  title: string
  tasks: TaskItem[]
  lists: TaskListModel[]
  emptyLabel: string
  /** Only the due-today list supports reordering — see docs/UPDATES.md §2.5. */
  reorderable?: boolean
}) {
  // The list name only earns its place when more than one list is in play.
  const showListName = lists.length > 1

  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="card">
        {tasks.length === 0 && <p className="empty">{emptyLabel}</p>}
        {tasks.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            showListName={showListName}
            listName={lists.find((l) => l.id === task.listId)?.title}
            reorder={
              reorderable
                ? { canMoveUp: index > 0, canMoveDown: index < tasks.length - 1 }
                : undefined
            }
          />
        ))}
      </div>
    </section>
  )
}
