/**
 * Structured, allowlisted logging. Forge bills log volume and logs are visible to us (the vendor), so:
 * one JSON line per event, only the fields below, and anything that looks like a webhook token is scrubbed.
 * Never pass issue content (summaries, comments, names) or URLs here.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  connectionId?: string;
  issueId?: string;
  eventType?: string;
  kind?: string;
  status?: number;
  latencyMs?: number;
  attempt?: number;
  errorCode?: string;
  count?: number;
  reason?: string;
  durationMs?: number;
}

const ALLOWED = new Set<keyof LogFields>([
  'connectionId', 'issueId', 'eventType', 'kind', 'status', 'latencyMs', 'attempt', 'errorCode', 'count', 'reason', 'durationMs',
]);

export interface Logger {
  log(level: LogLevel, msg: string, fields?: LogFields): void;
}

const TOKEN_RE = /(token|key)=[^&\s"]+/gi;
const CHAT_URL_RE = /https:\/\/chat\.googleapis\.com\/[^\s"]*/gi;

export function scrub(value: string): string {
  return value.replace(CHAT_URL_RE, '[webhook-url]').replace(TOKEN_RE, '$1=[redacted]');
}

export function formatLogLine(level: LogLevel, msg: string, fields: LogFields = {}): string {
  const out: Record<string, unknown> = { level, msg: scrub(msg) };
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k as keyof LogFields) || v === undefined) continue;
    out[k] = typeof v === 'string' ? scrub(v).slice(0, 200) : v;
  }
  return JSON.stringify(out);
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return {
    log(level, msg, fields) {
      if (order[level] < order[minLevel]) return;
      const line = formatLogLine(level, msg, fields);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}

export const silentLogger: Logger = { log() {} };
