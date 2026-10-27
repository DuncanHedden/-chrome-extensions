import { classifyChatError } from '../chat/errors';
import type { ChatMessage, OutboundMessage } from '../chat/message';
import { buildSendUrl } from '../chat/webhook-url';
import type { Clock } from '../clock';
import { systemClock } from '../clock';
import type { Destination, DestinationTarget, SendResult } from './destination';

/** Minimal fetch shape shared by global fetch and @forge/api's fetch. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string>; headers: { get(name: string): string | null } }>;

export class WebhookDestination implements Destination {
  readonly kind = 'webhook';

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly clock: Clock = systemClock,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: OutboundMessage, target: DestinationTarget): Promise<SendResult> {
    const started = this.clock.now();
    const url = buildSendUrl(target.webhookUrl, target.threaded && !!message.threadKey);
    const withThread = (m: ChatMessage): ChatMessage =>
      target.threaded && message.threadKey ? { ...m, thread: { threadKey: message.threadKey } } : m;

    const first = await this.post(url, withThread(message.card));
    if (first.ok) return { ok: true, status: first.status, latencyMs: this.clock.now() - started, usedFallback: false };

    // A 400 on the card is most often a widget Chat won't accept; plain text almost always gets through.
    if (first.status === 400) {
      const second = await this.post(url, withThread(message.fallback));
      if (second.ok) return { ok: true, status: second.status, latencyMs: this.clock.now() - started, usedFallback: true };
      return this.failure(second, started);
    }
    return this.failure(first, started);
  }

  private failure(r: PostResult, started: number): SendResult {
    const latencyMs = this.clock.now() - started;
    if (r.status === 0) {
      return {
        ok: false,
        status: 0,
        latencyMs,
        code: r.timedOut ? 'timeout' : 'network',
        retryable: true,
        explanation: r.timedOut ? 'Google Chat did not answer in time. Threadline will retry.' : 'Could not reach Google Chat. Threadline will retry.',
      };
    }
    return { ok: false, status: r.status, latencyMs, retryAfterSeconds: r.retryAfter, ...classifyChatError(r.status, r.body) };
  }

  private async post(url: string, body: ChatMessage): Promise<PostResult> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      const text = res.status >= 200 && res.status < 300 ? '' : (await res.text()).slice(0, 2_000);
      const ra = res.headers.get('retry-after');
      const retryAfter = ra && /^\d+$/.test(ra) ? Number(ra) : undefined;
      return { ok: res.status >= 200 && res.status < 300, status: res.status, body: text, retryAfter };
    } catch (err) {
      const timedOut = (err as { name?: string })?.name === 'AbortError';
      return { ok: false, status: 0, body: '', timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

interface PostResult {
  ok: boolean;
  status: number;
  body: string;
  retryAfter?: number;
  timedOut?: boolean;
}
