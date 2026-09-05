import { useState } from 'react'
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

function AddTask() {
  const addTask = useApp((s) => s.addTask)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || busy) return
    setBusy(true)
    // Cleared straight away: the common case is adding several in a row, and
    // waiting on the round trip to type the next one is the wrong feel.
    setTitle('')
    try {
      await addTask(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="row addtask" onSubmit={(e) => void submit(e)}>
      <span className="addtask__plus" aria-hidden="true">
        +
      </span>
      <input
        className="addtask__input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task"
        aria-label="Add a task"
      />
    </form>
  )
}

export function TaskList({
  title,
  tasks,
  lists,
  emptyLabel,
  allowAdding = false,
}: {
  title: string
  tasks: TaskItem[]
  lists: TaskListModel[]
  emptyLabel: string
  allowAdding?: boolean
}) {
  // The list name only earns its place when more than one list is in play.
  const showListName = lists.length > 1

  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="card">
        {tasks.length === 0 && !allowAdding && <p className="empty">{emptyLabel}</p>}
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showListName={showListName}
            listName={lists.find((l) => l.id === task.listId)?.title}
          />
        ))}
        {allowAdding && <AddTask />}
      </div>
    </section>
  )
}
