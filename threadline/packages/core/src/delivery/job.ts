import type { OutboundMessage } from '../chat/message';

export interface DeliveryJob {
  /** Stable per (connection, source event): the consumer's idempotency key. */
  id: string;
  connectionId: string;
  spaceId: string;
  message: OutboundMessage;
  meta: {
    product: 'jira' | 'confluence';
    /** e.g. the issue key. Shown in the delivery log; not considered content. */
    itemKey: string;
    eventKind: string;
    eventAt: number;
  };
  createdAt: number;
}

export interface DeliveryAttemptState {
  /** Send attempts that failed so far. */
  attempt: number;
  /** Times the job was postponed by the rate limiter (not counted as attempts). */
  deferrals: number;
}

export interface DeliveryQueue {
  enqueue(jobs: DeliveryJob[]): Promise<void>;
}
