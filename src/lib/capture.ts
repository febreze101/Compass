/**
 * The capture rule.
 *
 * Google Tasks cannot store a time and there is no workaround (docs/SCOPE.md
 * §7), so Compass takes the honest model that falls out of it: *a thing with a
 * time is a calendar event; a thing with only a day is a task.* One input, and
 * the presence of a time decides which side of the page it lands on.
 *
 * Kept separate from the component so the rule is testable on its own — it is
 * the one piece of product logic in the capture box, and everything else there
 * is form plumbing.
 */

import type { TimeKey } from './date'

export type Capture =
  | { kind: 'task'; title: string }
  | { kind: 'event'; title: string; startTime: TimeKey }

/**
 * Routes a captured line to a task or an event.
 *
 * Returns `null` for an empty title rather than throwing: submitting an empty
 * box is an ordinary thing to do by accident, and the right response is to do
 * nothing, not to raise an error at the user.
 */
export function classifyCapture(input: { title: string; time?: string }): Capture | null {
  const title = input.title.trim()
  if (!title) return null

  const time = input.time?.trim()
  return time ? { kind: 'event', title, startTime: time } : { kind: 'task', title }
}
