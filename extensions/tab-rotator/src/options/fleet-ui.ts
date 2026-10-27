import { h } from '@ext/shared/dom';
import { exportConfig } from '../fleet/config.ts';
import { fleetStatusStore, type FleetStatus } from '../fleet/poll.ts';
import { formatDuration } from '../engine/reconcile.ts';
import type { FleetSettings } from '../engine/types.ts';
import { hasOrigin, requestOrigin } from './alerts-ui.ts';
import type { Ctx } from './context.ts';
import { $, flashSaved, sendToBackground } from './ui.ts';

export function initFleet(ctx: Ctx): () => void {
  let status: FleetStatus | null = null;
  const save = (patch: Partial<FleetSettings>) => ctx.save({ fleet: { ...ctx.settings.fleet, ...patch } });
  const error = $('#fleet-error');

  $<HTMLInputElement>('#config-url').addEventListener('change', async (e) => {
    const url = (e.target as HTMLInputElement).value.trim();
    error.textContent = '';
    if (url && !(await requestOrigin(url))) error.textContent = 'Chrome needs permission to read that address. Click "Check now" to allow it.';
    await save({ configUrl: url });
    if (url) void sendToBackground('pollFleet');
    render();
  });
  $<HTMLInputElement>('#config-auth').addEventListener('change', (e) => void save({ authHeader: (e.target as HTMLInputElement).value.trim() }));
  $<HTMLInputElement>('#poll-minutes').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const minutes = Math.min(1440, Math.max(1, Math.round(Number(input.value)) || 5));
    input.value = String(minutes);
    void save({ pollMinutes: minutes });
  });
  $('#poll-now').addEventListener('click', async () => {
    const url = ctx.settings.fleet.configUrl;
    if (!url) return;
    if (!(await hasOrigin(url)) && !(await requestOrigin(url))) {
      error.textContent = 'Without permission to read that address, this screen can’t fetch its config.';
      return;
    }
    $('#fleet-status').textContent = 'Checking…';
    await sendToBackground('pollFleet');
  });

  $('#export-config').addEventListener('click', () => {
    const json = JSON.stringify(exportConfig(ctx.settings, ctx.state.running), null, 2);
    const a = h('a', {
      href: URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' })),
      download: `tab-rotator-${(ctx.settings.screenName || 'screen').replace(/[^\w.-]+/g, '-')}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $<HTMLInputElement>('#import-config').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await sendToBackground('importConfig', { text: await file.text() });
    const latest = await fleetStatusStore.get();
    if (latest.lastError) error.textContent = latest.lastError;
    else flashSaved('Imported');
  });

  function render() {
    const f = ctx.settings.fleet;
    $<HTMLInputElement>('#config-url').value = f.configUrl;
    $<HTMLInputElement>('#config-auth').value = f.authHeader;
    $<HTMLInputElement>('#poll-minutes').value = String(f.pollMinutes);
    $<HTMLButtonElement>('#poll-now').disabled = !f.configUrl;
    if (status) {
      const ago = (t: number) => (t ? `${formatDuration(Date.now() - t)} ago` : 'never');
      $('#fleet-status').textContent = f.configUrl
        ? `Last checked ${ago(status.lastFetchAt)} · last applied ${ago(status.lastAppliedAt)}${status.lastAppliedAt && !status.screenFound ? ` · no section for "${ctx.settings.screenName || '(no name)'}", using defaults` : ''}`
        : '';
      error.textContent = f.configUrl ? status.lastError : '';
    }
    const banner = $('#managed-banner');
    banner.hidden = !(ctx.license.pro && f.configUrl && status?.lastAppliedAt);
    banner.textContent = `This screen is managed by a fleet config file (${f.configUrl}). Changes you make here last until that file next changes.`;
  }

  void fleetStatusStore.get().then((s) => {
    status = s;
    render();
  });
  fleetStatusStore.watch((s) => {
    status = s;
    render();
  });
  return render;
}
