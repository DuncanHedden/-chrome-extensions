export interface ParsedWebhookUrl {
  /** Canonical URL with only `key` and `token`; threading params are added per request. */
  url: string;
  spaceId: string;
  masked: string;
}

export type WebhookUrlError =
  | { code: 'empty'; message: string }
  | { code: 'space_link'; message: string }
  | { code: 'not_https'; message: string }
  | { code: 'wrong_host'; message: string }
  | { code: 'wrong_path'; message: string }
  | { code: 'missing_token'; message: string };

const SPACE_PATH = /^\/v1\/spaces\/([A-Za-z0-9_-]+)\/messages\/?$/;

export function parseWebhookUrl(input: string): { ok: true; value: ParsedWebhookUrl } | { ok: false; error: WebhookUrlError } {
  const raw = input.trim().replace(/^<|>$/g, '');
  if (!raw) return { ok: false, error: { code: 'empty', message: 'Paste the webhook URL from your Google Chat space.' } };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: { code: 'wrong_host', message: 'That is not a URL. Webhook URLs start with https://chat.googleapis.com/v1/spaces/.' } };
  }

  if (u.hostname === 'chat.google.com' || u.hostname === 'mail.google.com') {
    return {
      ok: false,
      error: {
        code: 'space_link',
        message: 'That is a link to the space, not a webhook. In the space, open the space name menu → Apps & integrations → Webhooks, then copy the webhook URL.',
      },
    };
  }
  if (u.protocol !== 'https:') return { ok: false, error: { code: 'not_https', message: 'Webhook URLs must use https://.' } };
  if (u.hostname !== 'chat.googleapis.com') {
    return { ok: false, error: { code: 'wrong_host', message: 'Webhook URLs must be on chat.googleapis.com.' } };
  }
  const m = SPACE_PATH.exec(u.pathname);
  if (!m) return { ok: false, error: { code: 'wrong_path', message: 'Expected a URL like https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=….' } };

  const key = u.searchParams.get('key');
  const token = u.searchParams.get('token');
  if (!key || !token) {
    return { ok: false, error: { code: 'missing_token', message: 'The URL is missing its key or token. Copy the full webhook URL; it is long.' } };
  }

  const spaceId = m[1]!;
  const canonical = new URL(`https://chat.googleapis.com/v1/spaces/${spaceId}/messages`);
  canonical.searchParams.set('key', key);
  canonical.searchParams.set('token', token);
  return { ok: true, value: { url: canonical.toString(), spaceId, masked: maskWebhook(spaceId, token) } };
}

export function maskWebhook(spaceId: string, token: string): string {
  const space = spaceId.length > 4 ? `${spaceId.slice(0, 4)}…` : spaceId;
  return `https://chat.googleapis.com/v1/spaces/${space}/messages?key=…&token=…${token.slice(-4)}`;
}

/** Threaded sends reply in the issue's thread, or start it if it doesn't exist yet. */
export function buildSendUrl(canonicalUrl: string, threaded: boolean): string {
  if (!threaded) return canonicalUrl;
  const u = new URL(canonicalUrl);
  u.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
  return u.toString();
}
