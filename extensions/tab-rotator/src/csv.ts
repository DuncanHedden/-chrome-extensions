import type { LogEntry } from './engine/types.ts';

const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Health log as CSV (RFC 4180): ISO UTC time first so spreadsheets sort it correctly. */
export function healthLogCsv(entries: readonly LogEntry[], screenName = ''): string {
  const header = ['time_utc', 'local_time', 'screen', 'level', 'event', 'message', 'url'];
  const rows = entries.map((e) => [
    new Date(e.at).toISOString(),
    new Date(e.at).toLocaleString(),
    screenName,
    e.level,
    e.code,
    e.message,
    e.url ?? '',
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
