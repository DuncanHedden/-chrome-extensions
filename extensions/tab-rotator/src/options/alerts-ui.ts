import { originPattern } from '../alerts/send.ts';
import type { AlertSettings } from '../engine/types.ts';
import type { Ctx } from './context.ts';
import { $, sendToBackground } from './ui.ts';

/** Ask for permission to POST to the webhook's origin. Must run inside a user gesture. */
export async function requestOrigin(url: string): Promise<boolean> {
  const origin = originPattern(url);
  return !!origin && (await chrome.permissions.request({ origins: [origin] }));
}

export async function hasOrigin(url: string): Promise<boolean> {
  const origin = originPattern(url);
  return !!origin && (await chrome.permissions.contains({ origins: [origin] }));
}

export function initAlerts(ctx: Ctx): () => void {
  const save = (patch: Partial<AlertSettings>) => ctx.save({ alerts: { ...ctx.settings.alerts, ...patch } });
  const status = $('#alert-status');

  $<HTMLInputElement>('#webhook-url').addEventListener('change', async (e) => {
    const url = (e.target as HTMLInputElement).value.trim();
    if (url && !(await requestOrigin(url))) status.textContent = 'Chrome needs permission to send to that address; click "Allow sending to this webhook".';
    await save({ webhookUrl: url });
    render();
  });
  $<HTMLSelectElement>('#webhook-format').addEventListener('change', (e) => void save({ format: (e.target as HTMLSelectElement).value as AlertSettings['format'] }));
  $<HTMLInputElement>('#heartbeat').addEventListener('change', (e) => void save({ heartbeat: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('#heartbeat-time').addEventListener('change', (e) => void save({ heartbeatTime: (e.target as HTMLInputElement).value || '09:00' }));
  $('#grant-webhook').addEventListener('click', async () => {
    if (await requestOrigin(ctx.settings.alerts.webhookUrl)) render();
  });
  $('#test-alert').addEventListener('click', async () => {
    status.textContent = 'Sending…';
    const resp = (await sendToBackground('testAlert')) as { ok: boolean; result?: string | null; error?: string };
    status.textContent = !resp.ok ? resp.error ?? 'Failed.' : resp.result ? resp.result : 'Sent. Check your channel.';
  });

  function render() {
    const a = ctx.settings.alerts;
    $<HTMLInputElement>('#webhook-url').value = a.webhookUrl;
    $<HTMLSelectElement>('#webhook-format').value = a.format;
    $<HTMLInputElement>('#heartbeat').checked = a.heartbeat;
    $<HTMLInputElement>('#heartbeat-time').value = a.heartbeatTime;
    $<HTMLButtonElement>('#test-alert').disabled = !a.webhookUrl;
    void hasOrigin(a.webhookUrl).then((ok) => ($('#grant-webhook').hidden = !a.webhookUrl || ok));
  }
  return render;
}
