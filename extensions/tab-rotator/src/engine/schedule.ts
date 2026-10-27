import type { Schedule } from './types.ts';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Day of week and minutes past midnight on the wall clock in `timeZone` (empty = this computer's). */
export function wallClock(at: number, timeZone = ''): { weekday: number; minutes: number } {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return { weekday: WEEKDAYS[parts.weekday!]!, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "HH:MM" -> minutes past midnight, or null if malformed. */
export function parseTime(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Whether `at` falls inside the schedule's display hours. Evaluated on the wall clock, so DST shifts are
 * handled by the time zone database: "07:00" means 07:00 local on both sides of a change. A disabled or
 * empty schedule is always on. An invalid time zone falls back to this computer's.
 */
export function isWithinSchedule(schedule: Schedule, at: number): boolean {
  if (!schedule.enabled || schedule.windows.length === 0) return true;
  const { weekday, minutes } = wallClock(at, isValidTimeZone(schedule.timeZone) ? schedule.timeZone : '');
  const yesterday = (weekday + 6) % 7;
  return schedule.windows.some((w) => {
    const start = parseTime(w.start);
    const end = parseTime(w.end);
    if (start === null || end === null) return false;
    if (start === end) return w.days.includes(weekday); // all day
    if (start < end) return w.days.includes(weekday) && minutes >= start && minutes < end;
    // Crosses midnight: the evening part belongs to today, the early-morning part to yesterday's window.
    return (w.days.includes(weekday) && minutes >= start) || (w.days.includes(yesterday) && minutes < end);
  });
}
