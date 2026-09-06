/**
 * Autosave for the daily note.
 *
 * Typing shouldn't hit the disk on every keystroke, and the user should never
 * have to think about saving. So edits are held briefly and written once the
 * typing stops.
 *
 * The hazard this exists to close is the note landing on the wrong day. An edit
 * is queued against the day it was typed on, and switching days writes the
 * outstanding one immediately rather than letting a timer fire after the view
 * has moved on. Writes are also chained, never overlapped: two saves racing on
 * one file can leave the older text on top.
 */

import type { DayKey } from './date'

/** Long enough to coalesce a burst of typing, short enough to feel automatic. */
const DEFAULT_DELAY_MS = 800

export interface NoteSaver {
  /** Records an edit, to be written once typing settles. */
  queue(day: DayKey, text: string): void
  /** Writes any outstanding edit now, and resolves when the disk is caught up. */
  flush(): Promise<void>
  /** True while an edit is waiting on the timer. */
  isPending(): boolean
  /** Drops the timer without writing. For teardown only. */
  cancel(): void
}

export function createNoteSaver(options: {
  write: (day: DayKey, text: string) => Promise<void>
  delay?: number
  /** Fired when a write fails; the store turns it into a visible error. */
  onError?: (error: unknown) => void
  /** Tracks whether a write is in flight, for the "Saving…" hint. */
  onBusyChange?: (busy: boolean) => void
}): NoteSaver {
  const { write, delay = DEFAULT_DELAY_MS, onError, onBusyChange } = options

  let pending: { day: DayKey; text: string } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled: Promise<void> = Promise.resolve()
  let active = 0

  function stopTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function track(delta: number): void {
    active += delta
    onBusyChange?.(active > 0)
  }

  /** Hands the outstanding edit to the store, behind any write already going. */
  function commit(): Promise<void> {
    stopTimer()
    const entry = pending
    pending = null
    if (!entry) return settled

    track(1)
    settled = settled
      .then(() => write(entry.day, entry.text))
      .catch((error: unknown) => onError?.(error))
      .finally(() => track(-1))
    return settled
  }

  return {
    queue(day, text) {
      // A new day with an edit still outstanding means that edit belongs to a
      // file about to leave the screen. Write it now; letting the timer fire
      // later is how a note ends up under the wrong date.
      if (pending && pending.day !== day) void commit()

      pending = { day, text }
      stopTimer()
      timer = setTimeout(() => void commit(), delay)
    },

    flush: () => commit(),
    isPending: () => pending !== null,
    cancel: stopTimer,
  }
}
