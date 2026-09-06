import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoteSaver } from './notes'

function recorder() {
  const writes: { day: string; text: string }[] = []
  return {
    writes,
    write: vi.fn(async (day: string, text: string) => void writes.push({ day, text })),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createNoteSaver', () => {
  it('waits for typing to stop before writing', async () => {
    const disk = recorder()
    const saver = createNoteSaver({ write: disk.write, delay: 800 })

    saver.queue('2026-09-05', 'H')
    saver.queue('2026-09-05', 'He')
    saver.queue('2026-09-05', 'Hel')
    expect(disk.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(800)
    // One write, carrying the last text — not one per keystroke.
    expect(disk.writes).toEqual([{ day: '2026-09-05', text: 'Hel' }])
  })

  it('writes the outstanding edit to the day it was typed on', async () => {
    // The bug this guards: type, immediately move to another day, and the
    // timer fires against whichever day happens to be showing.
    const disk = recorder()
    const saver = createNoteSaver({ write: disk.write, delay: 800 })

    saver.queue('2026-09-05', 'belongs to the 5th')
    saver.queue('2026-09-06', 'belongs to the 6th')
    await vi.advanceTimersByTimeAsync(800)

    expect(disk.writes).toEqual([
      { day: '2026-09-05', text: 'belongs to the 5th' },
      { day: '2026-09-06', text: 'belongs to the 6th' },
    ])
  })

  it('flushes on demand without waiting for the timer', async () => {
    const disk = recorder()
    const saver = createNoteSaver({ write: disk.write, delay: 800 })

    saver.queue('2026-09-05', 'unsaved')
    await saver.flush()
    expect(disk.writes).toEqual([{ day: '2026-09-05', text: 'unsaved' }])

    // The timer must not fire a second, redundant write afterwards.
    await vi.advanceTimersByTimeAsync(800)
    expect(disk.writes).toHaveLength(1)
  })

  it('is a no-op to flush with nothing outstanding', async () => {
    const disk = recorder()
    const saver = createNoteSaver({ write: disk.write })
    await saver.flush()
    expect(disk.writes).toHaveLength(0)
  })

  it('never lets two writes overlap', async () => {
    // Concurrent writes to one file can land out of order and leave the older
    // text on top.
    const order: string[] = []
    // Held on an object: a plain `let` assigned inside the executor gets
    // narrowed to null by control-flow analysis and won't typecheck.
    const gate: { release?: () => void } = {}
    const write = vi.fn(async (_day: string, text: string) => {
      order.push(`start:${text}`)
      if (text === 'first') await new Promise<void>((resolve) => (gate.release = resolve))
      order.push(`end:${text}`)
    })
    const saver = createNoteSaver({ write, delay: 0 })

    saver.queue('2026-09-05', 'first')
    await vi.advanceTimersByTimeAsync(0)
    saver.queue('2026-09-05', 'second')
    await vi.advanceTimersByTimeAsync(0)

    expect(order).toEqual(['start:first'])
    gate.release?.()
    await vi.runAllTimersAsync()
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  it('reports a failed write instead of throwing into the timer', async () => {
    // An unhandled rejection inside a setTimeout callback has nowhere to go.
    const onError = vi.fn()
    const saver = createNoteSaver({
      write: async () => {
        throw new Error('disk full')
      },
      delay: 0,
      onError,
    })

    saver.queue('2026-09-05', 'text')
    await vi.runAllTimersAsync()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
  })

  it('keeps saving after a failure', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue(undefined)
    const saver = createNoteSaver({ write, delay: 0, onError: () => {} })

    saver.queue('2026-09-05', 'one')
    await vi.runAllTimersAsync()
    saver.queue('2026-09-05', 'two')
    await vi.runAllTimersAsync()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('2026-09-05', 'two')
  })

  it('tracks whether a write is in flight', async () => {
    const busy: boolean[] = []
    const saver = createNoteSaver({
      write: async () => {},
      delay: 0,
      onBusyChange: (b) => busy.push(b),
    })

    saver.queue('2026-09-05', 'text')
    await vi.runAllTimersAsync()
    expect(busy).toEqual([true, false])
  })

  it('reports and clears pending state', async () => {
    const saver = createNoteSaver({ write: async () => {}, delay: 800 })
    expect(saver.isPending()).toBe(false)

    saver.queue('2026-09-05', 'text')
    expect(saver.isPending()).toBe(true)

    await saver.flush()
    expect(saver.isPending()).toBe(false)
  })

  it('drops a pending edit on cancel', async () => {
    const disk = recorder()
    const saver = createNoteSaver({ write: disk.write, delay: 800 })

    saver.queue('2026-09-05', 'abandoned')
    saver.cancel()
    await vi.advanceTimersByTimeAsync(800)
    expect(disk.writes).toHaveLength(0)
  })
})
