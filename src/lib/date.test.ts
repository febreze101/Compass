import { describe, expect, it } from 'vitest'
import {
  addDays,
  atTime,
  dayKeyOf,
  dayRange,
  isSameDayKey,
  minutesBetween,
  parseDayKey,
  timeOfDay,
  todayKey,
} from './date'

describe('atTime', () => {
  it('lands on the wall-clock time of the given local day', () => {
    const at = atTime('2026-09-05', '09:30')
    expect(dayKeyOf(at)).toBe('2026-09-05')
    expect(at.getHours()).toBe(9)
    expect(at.getMinutes()).toBe(30)
    expect(at.getSeconds()).toBe(0)
  })

  it('accepts the edges of the clock', () => {
    expect(timeOfDay(atTime('2026-09-05', '00:00'))).toBe('00:00')
    expect(timeOfDay(atTime('2026-09-05', '23:59'))).toBe('23:59')
  })

  it.each(['9:30', '24:00', '12:60', '0930', '', 'noon'])('rejects %o', (time) => {
    expect(() => atTime('2026-09-05', time)).toThrow(/HH:MM/)
  })

  it('rejects an impossible day just as parseDayKey does', () => {
    expect(() => atTime('2026-02-30', '09:00')).toThrow(/no such date/)
  })
})

describe('timeOfDay', () => {
  it('zero-pads to HH:MM', () => {
    expect(timeOfDay(new Date(2026, 8, 5, 7, 5))).toBe('07:05')
  })

  it('round-trips through atTime', () => {
    expect(timeOfDay(atTime('2026-09-05', '14:45'))).toBe('14:45')
  })
})

describe('minutesBetween', () => {
  it('counts whole minutes forward', () => {
    expect(minutesBetween(atTime('2026-09-05', '09:00'), atTime('2026-09-05', '10:30'))).toBe(90)
  })

  it('goes negative when the end is earlier', () => {
    expect(minutesBetween(atTime('2026-09-05', '10:00'), atTime('2026-09-05', '09:45'))).toBe(-15)
  })
})

describe('dayKeyOf', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(dayKeyOf(new Date(2026, 8, 5, 14, 30))).toBe('2026-09-05')
  })

  it('pads single-digit months and days', () => {
    expect(dayKeyOf(new Date(2026, 0, 3, 0, 0))).toBe('2026-01-03')
  })

  it('uses local time, not UTC, so late-evening times do not roll over', () => {
    // 23:30 local on the 5th is the 6th in UTC for any timezone behind UTC.
    expect(dayKeyOf(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05')
  })
})

describe('parseDayKey', () => {
  it('returns local midnight for the given day', () => {
    const d = parseDayKey('2026-09-05')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(5)
    expect(d.getHours()).toBe(0)
  })

  it('round-trips with dayKeyOf', () => {
    expect(dayKeyOf(parseDayKey('2028-02-29'))).toBe('2028-02-29')
  })

  it('rejects malformed keys', () => {
    expect(() => parseDayKey('05-09-2026')).toThrow()
    expect(() => parseDayKey('2026-9-5')).toThrow()
    expect(() => parseDayKey('')).toThrow()
    expect(() => parseDayKey('2026-02-29')).toThrow() // 2026 is not a leap year
  })
})

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-09-05', 1)).toBe('2026-09-06')
    expect(addDays('2026-09-05', -1)).toBe('2026-09-04')
  })

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('dayRange', () => {
  it('spans local midnight to local midnight the next day', () => {
    const { timeMin, timeMax } = dayRange('2026-09-05')
    expect(new Date(timeMin).getTime()).toBe(new Date(2026, 8, 5, 0, 0, 0, 0).getTime())
    expect(new Date(timeMax).getTime()).toBe(new Date(2026, 8, 6, 0, 0, 0, 0).getTime())
  })

  it('produces RFC3339 strings the Calendar API accepts', () => {
    const { timeMin, timeMax } = dayRange('2026-09-05')
    // Offset form (…+02:00) or Z, both valid RFC3339.
    expect(timeMin).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
    expect(timeMax).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
  })
})

describe('isSameDayKey / todayKey', () => {
  it('compares a Date against a day key in local time', () => {
    expect(isSameDayKey(new Date(2026, 8, 5, 9, 0), '2026-09-05')).toBe(true)
    expect(isSameDayKey(new Date(2026, 8, 6, 9, 0), '2026-09-05')).toBe(false)
  })

  it('todayKey agrees with dayKeyOf(now)', () => {
    expect(todayKey()).toBe(dayKeyOf(new Date()))
  })
})
