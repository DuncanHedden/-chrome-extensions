import type { ClassifiedError } from '../chat/errors';
import type { OutboundMessage } from '../chat/message';

/**
 * Where a rendered message goes. v1 ships `WebhookDestination`; Phase 3 adds a Chat API (app) destination that
 * can DM users and @-mention them, behind the same interface.
 */
export interface Destination<C = DestinationTarget> {
  readonly kind: string;
  send(message: OutboundMessage, target: C): Promise<SendResult>;
}

export interface DestinationTarget {
  connectionId: string;
  /** Resolved at send time from the secret store; never persisted outside it. */
  webhookUrl: string;
  threaded: boolean;
}

export type SendResult =
  | { ok: true; status: number; latencyMs: number; usedFallback: boolean }
  | ({ ok: false; status: number; latencyMs: number; retryAfterSeconds?: number } & ClassifiedError);
