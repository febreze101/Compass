import { describe, expect, it } from 'vitest'
import { classifyCapture } from './capture'

describe('classifyCapture', () => {
  it('makes a task when no time is given', () => {
    expect(classifyCapture({ title: 'Call the dentist' })).toEqual({
      kind: 'task',
      title: 'Call the dentist',
    })
  })

  it('makes an event when a time is given', () => {
    expect(classifyCapture({ title: 'Dentist', time: '15:00' })).toEqual({
      kind: 'event',
      title: 'Dentist',
      startTime: '15:00',
    })
  })

  it('treats a blank time as no time', () => {
    // An empty <input type="time"> reports '', which must not tip a task into
    // being a zero-o'clock event.
    expect(classifyCapture({ title: 'Buy milk', time: '' })?.kind).toBe('task')
    expect(classifyCapture({ title: 'Buy milk', time: '   ' })?.kind).toBe('task')
  })

  it('keeps midnight as a real time', () => {
    // '00:00' is falsy-adjacent only by accident of formatting; it is a time
    // the user deliberately picked.
    expect(classifyCapture({ title: 'Deploy', time: '00:00' })).toMatchObject({
      kind: 'event',
      startTime: '00:00',
    })
  })

  it('trims the title', () => {
    expect(classifyCapture({ title: '  Standup  ' })?.title).toBe('Standup')
  })

  it('returns null for an empty title rather than throwing', () => {
    expect(classifyCapture({ title: '' })).toBeNull()
    expect(classifyCapture({ title: '   ' })).toBeNull()
    // A time alone still isn't something worth creating.
    expect(classifyCapture({ title: '  ', time: '09:00' })).toBeNull()
  })
})
