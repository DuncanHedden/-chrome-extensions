/** Classification of Google Chat webhook responses into actionable, admin-readable outcomes. */
export type DeliveryErrorCode =
  | 'invalid_url'
  | 'webhooks_disabled'
  | 'webhook_revoked'
  | 'space_not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'server_error'
  | 'network'
  | 'timeout';

export interface ClassifiedError {
  code: DeliveryErrorCode;
  retryable: boolean;
  /** One or two sentences an admin can act on. Contains no secrets or issue content. */
  explanation: string;
  helpUrl?: string;
}

export const WEBHOOK_ADMIN_SETTING_URL = 'https://support.google.com/a/answer/7651360';

export function classifyChatError(status: number, body: string): ClassifiedError {
  const lower = body.toLowerCase();
  if (status === 429) {
    return {
      code: 'rate_limited',
      retryable: true,
      explanation: 'Google Chat is rate limiting this space (about 1 message per second, shared by every webhook in the space). Threadline will retry automatically.',
    };
  }
  if (status === 404 || lower.includes('not_found') || lower.includes('space not found')) {
    return {
      code: 'space_not_found',
      retryable: false,
      explanation: 'Google Chat could not find this space or webhook. The space may have been deleted, or the webhook removed. Create a new webhook in the space and paste the new URL.',
    };
  }
  if (status === 401 || status === 403) {
    // Chat returns PERMISSION_DENIED both when the Workspace admin has turned webhooks off and when the webhook
    // was deleted/its token rotated. The body sometimes names the cause; otherwise we explain both.
    if (lower.includes('token') || (lower.includes('webhook') && lower.includes('invalid'))) {
      return {
        code: 'webhook_revoked',
        retryable: false,
        explanation: 'Google Chat rejected the webhook token. The webhook was probably deleted or recreated. Copy the current webhook URL from the space and paste it again.',
      };
    }
    return {
      code: 'webhooks_disabled',
      retryable: false,
      explanation:
        'Google Chat refused the message (permission denied). Usually your Google Workspace admin has turned off incoming webhooks: Admin console → Apps → Google Workspace → Google Chat → Chat apps → "Allow users to add and use incoming webhooks". It can also mean the webhook was deleted from the space.',
      helpUrl: WEBHOOK_ADMIN_SETTING_URL,
    };
  }
  if (status === 400) {
    return {
      code: 'bad_request',
      retryable: false,
      explanation: 'Google Chat rejected the message format. Threadline retries such messages as plain text; if this persists, contact support with the delivery time.',
    };
  }
  if (status >= 500) {
    return { code: 'server_error', retryable: true, explanation: `Google Chat had a temporary error (HTTP ${status}). Threadline will retry automatically.` };
  }
  return { code: 'bad_request', retryable: false, explanation: `Google Chat answered with an unexpected HTTP ${status}.` };
}
