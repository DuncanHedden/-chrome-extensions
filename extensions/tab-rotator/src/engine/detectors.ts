import type { Detector, TabSnapshot } from './types.ts';

export type Matcher = { ok: true; test: (text: string) => boolean } | { ok: false; error: string };

/** "/regex/flags" is a regular expression; anything else is a case-insensitive substring. */
export function compileMatcher(pattern: string): Matcher {
  const trimmed = pattern.trim();
  if (!trimmed) return { ok: false, error: 'Enter some text or a /regex/.' };
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(trimmed);
  if (!regex) {
    const needle = trimmed.toLowerCase();
    return { ok: true, test: (text) => text.toLowerCase().includes(needle) };
  }
  try {
    const re = new RegExp(regex[1]!, regex[2]!.replace(/[gy]/g, ''));
    return { ok: true, test: (text) => re.test(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : String(error) };
  }
}

/** What "the page changed" means without reading the page: URL, title and favicon, plus page text if permitted. */
export function fingerprint(tab: TabSnapshot, contentHash = ''): string {
  return `${tab.url}\n${tab.title}\n${tab.favIconUrl}\n${contentHash}`;
}

/**
 * First enabled detector that matches this tab right now, or null. URL and title patterns are only
 * checked once the page has finished loading, so redirects and placeholder titles don't trip them.
 */
export function matchingDetector(
  detectors: readonly Detector[],
  tab: TabSnapshot,
  unchangedSince: number,
  now: number,
): Detector | null {
  for (const detector of detectors) {
    if (!detector.enabled) continue;
    if (detector.appliesTo && !tab.url.startsWith(detector.appliesTo)) continue;
    if (detector.kind === 'unchanged') {
      if (detector.minutes > 0 && now - unchangedSince >= detector.minutes * 60_000) return detector;
      continue;
    }
    if (tab.status !== 'complete') continue;
    const matcher = compileMatcher(detector.pattern);
    if (matcher.ok && matcher.test(detector.kind === 'url' ? tab.url : tab.title)) return detector;
  }
  return null;
}

/** Ready-made detectors offered in the UI. */
export const DETECTOR_PRESETS: Array<Omit<Detector, 'id'>> = [
  {
    name: 'Signed out (login / SSO page)',
    enabled: true,
    kind: 'url',
    pattern: '/\\/(login|signin|sign-in|sso|saml|oauth2?|auth)\\b|accounts\\.google\\.com|login\\.microsoftonline\\.com|okta\\.com/i',
    minutes: 0,
    checkContent: false,
    appliesTo: '',
    action: 'reopen',
  },
  {
    name: 'Error or expired-session title',
    enabled: true,
    kind: 'title',
    pattern: '/session (has )?expired|signed out|\\b(500|502|503|504)\\b|bad gateway|service unavailable|internal server error/i',
    minutes: 0,
    checkContent: false,
    appliesTo: '',
    action: 'reload',
  },
  {
    name: 'Error page URL',
    enabled: true,
    kind: 'url',
    pattern: '/\\/(error|errors|500|502|503|maintenance)(\\/|\\?|$)/i',
    minutes: 0,
    checkContent: false,
    appliesTo: '',
    action: 'reload',
  },
  {
    name: 'Frozen (nothing changed for 30 min)',
    enabled: true,
    kind: 'unchanged',
    pattern: '',
    minutes: 30,
    checkContent: false,
    appliesTo: '',
    action: 'reload',
  },
];
