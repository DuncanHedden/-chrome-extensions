import { describe, expect, it } from 'vitest';
import { isValidTimeZone, isWithinSchedule, parseTime, wallClock } from '../src/engine/schedule.ts';
import type { Schedule, ScheduleWindow } from '../src/engine/types.ts';

const NY = 'America/New_York';
const schedule = (windows: Array<Omit<ScheduleWindow, 'id'>>, timeZone = NY): Schedule => ({
  enabled: true,
  timeZone,
  windows: windows.map((w, i) => ({ id: String(i), ...w })),
  offHours: { kind: 'blank', url: '', entries: [] },
});
const WEEKDAYS = [1, 2, 3, 4, 5];
/** An instant given as New York wall-clock time (offset supplied explicitly). */
const ny = (iso: string) => Date.parse(iso);

describe('parseTime / wallClock / isValidTimeZone', () => {
  it('parses HH:MM and rejects junk', () => {
    expect(parseTime('07:00')).toBe(420);
    expect(parseTime('7:05')).toBe(425);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7')).toBeNull();
  });

  it('reads the wall clock in a time zone', () => {
    // 2026-10-26 (Monday) 12:00 UTC = 08:00 in New York (EDT)
    expect(wallClock(Date.UTC(2026, 9, 26, 12), NY)).toEqual({ weekday: 1, minutes: 8 * 60 });
    expect(wallClock(Date.UTC(2026, 9, 26, 12), 'Asia/Tokyo')).toEqual({ weekday: 1, minutes: 21 * 60 });
  });

  it('validates zones', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('isWithinSchedule', () => {
  const office = schedule([{ days: WEEKDAYS, start: '07:00', end: '18:00' }]);

  it('is always on when disabled or empty', () => {
    expect(isWithinSchedule({ ...office, enabled: false }, ny('2026-10-25T03:00:00-04:00'))).toBe(true);
    expect(isWithinSchedule({ ...office, windows: [] }, ny('2026-10-25T03:00:00-04:00'))).toBe(true);
  });

  it('weekday office hours, start inclusive and end exclusive', () => {
    expect(isWithinSchedule(office, ny('2026-10-26T06:59:00-04:00'))).toBe(false);
    expect(isWithinSchedule(office, ny('2026-10-26T07:00:00-04:00'))).toBe(true);
    expect(isWithinSchedule(office, ny('2026-10-26T17:59:00-04:00'))).toBe(true);
    expect(isWithinSchedule(office, ny('2026-10-26T18:00:00-04:00'))).toBe(false);
    expect(isWithinSchedule(office, ny('2026-10-25T12:00:00-04:00'))).toBe(false); // Sunday
  });

  it('a window crossing midnight belongs to the day it starts', () => {
    const night = schedule([{ days: [5], start: '22:00', end: '02:00' }]); // Friday night
    expect(isWithinSchedule(night, ny('2026-10-30T21:59:00-04:00'))).toBe(false);
    expect(isWithinSchedule(night, ny('2026-10-30T23:30:00-04:00'))).toBe(true); // Fri
    expect(isWithinSchedule(night, ny('2026-10-31T01:59:00-04:00'))).toBe(true); // Sat early = Fri's window
    expect(isWithinSchedule(night, ny('2026-10-31T02:00:00-04:00'))).toBe(false);
    expect(isWithinSchedule(night, ny('2026-10-31T23:00:00-04:00'))).toBe(false); // Sat night: not scheduled
    expect(isWithinSchedule(night, ny('2026-10-30T01:00:00-04:00'))).toBe(false); // Fri early = Thu's window
  });

  it('start == end means all day on those days', () => {
    const weekend = schedule([{ days: [0, 6], start: '00:00', end: '00:00' }]);
    expect(isWithinSchedule(weekend, ny('2026-10-31T00:00:00-04:00'))).toBe(true);
    expect(isWithinSchedule(weekend, ny('2026-11-01T23:59:00-05:00'))).toBe(true);
    expect(isWithinSchedule(weekend, ny('2026-11-02T00:00:00-05:00'))).toBe(false);
  });

  it('several windows combine (split shift)', () => {
    const split = schedule([
      { days: WEEKDAYS, start: '06:00', end: '10:00' },
      { days: WEEKDAYS, start: '16:00', end: '20:00' },
    ]);
    expect(isWithinSchedule(split, ny('2026-10-26T12:00:00-04:00'))).toBe(false);
    expect(isWithinSchedule(split, ny('2026-10-26T17:00:00-04:00'))).toBe(true);
  });

  it('DST fall back (Nov 1, 2026): 07:00 means 07:00 local on both sides', () => {
    const daily = schedule([{ days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '18:00' }]);
    // Saturday Oct 31 is EDT (-04:00); Sunday Nov 1 is EST (-05:00).
    expect(isWithinSchedule(daily, ny('2026-10-31T07:00:00-04:00'))).toBe(true);
    expect(isWithinSchedule(daily, ny('2026-11-01T06:30:00-05:00'))).toBe(false);
    expect(isWithinSchedule(daily, ny('2026-11-01T07:00:00-05:00'))).toBe(true);
    // The instant that was 07:00 yesterday is 06:00 today: off.
    expect(isWithinSchedule(daily, ny('2026-11-01T07:00:00-04:00'))).toBe(false);
  });

  it('DST spring forward (Mar 8, 2026): the skipped hour does not break a window spanning it', () => {
    const night = schedule([{ days: [6], start: '22:00', end: '06:00' }]); // Sat night into Sun
    expect(isWithinSchedule(night, ny('2026-03-08T01:59:00-05:00'))).toBe(true);
    expect(isWithinSchedule(night, ny('2026-03-08T03:00:00-04:00'))).toBe(true); // 02:00 never happens
    expect(isWithinSchedule(night, ny('2026-03-08T06:00:00-04:00'))).toBe(false);
  });

  it('uses the configured zone, not the computer’s', () => {
    const london = schedule([{ days: WEEKDAYS, start: '09:00', end: '17:00' }], 'Europe/London');
    expect(isWithinSchedule(london, Date.UTC(2026, 9, 26, 9, 30))).toBe(true); // 09:30 GMT
    expect(isWithinSchedule(london, Date.UTC(2026, 9, 26, 17, 30))).toBe(false);
  });

  it('falls back to the computer’s zone for an invalid zone instead of throwing', () => {
    expect(() => isWithinSchedule(schedule([{ days: WEEKDAYS, start: '07:00', end: '18:00' }], 'Nope/Nope'), Date.now())).not.toThrow();
  });
});
