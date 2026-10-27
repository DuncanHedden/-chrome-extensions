import { h } from '@ext/shared/dom';
import { licenseStore } from '@ext/shared/license';
import { formatPrice, LEMON_SQUEEZY, paymentsConfigured, PRICES } from '../pricing.ts';
import type { Ctx } from './context.ts';
import { $, sendToBackground } from './ui.ts';

export function initLicense(ctx: Ctx): () => void {
  const error = $('#license-error');
  $('#license-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $<HTMLInputElement>('#license-key').value.trim();
    if (!key) return;
    error.textContent = 'Activating…';
    const resp = (await sendToBackground('activateLicense', { key })) as { ok: boolean; result?: string | null; error?: string };
    error.textContent = !resp.ok ? resp.error ?? 'Activation failed.' : resp.result ?? '';
  });
  $('#license-deactivate').addEventListener('click', async () => {
    if (!confirm('Deactivate Pro on this screen? Its activation becomes free for another screen.')) return;
    const resp = (await sendToBackground('deactivateLicense')) as { ok: boolean; error?: string };
    error.textContent = resp.ok ? '' : resp.error ?? 'Could not deactivate.';
  });

  const plans: Array<[keyof typeof LEMON_SQUEEZY.checkout, string]> = [
    ['monthly', `${formatPrice(PRICES.monthly)} / month`],
    ['yearly', `${formatPrice(PRICES.yearly)} / year`],
    ['lifetime', `${formatPrice(PRICES.lifetime)} once`],
  ];
  $('#buy').replaceChildren(
    ...plans.map(([plan, label]) => {
      const url = LEMON_SQUEEZY.checkout[plan];
      return url
        ? h('a', { class: 'button-link', href: url, target: '_blank', rel: 'noopener' }, `Buy: ${label} per screen`)
        : h('button', { type: 'button', disabled: true, title: 'Checkout links are not configured in this build' }, `${label} per screen`);
    }),
  );

  async function render() {
    const license = await licenseStore.get();
    const paid = license.source === 'paid';
    $('#license-deactivate').hidden = !(paid && license.instanceId);
    $<HTMLInputElement>('#license-key').value = paid && license.key ? license.key : '';
    let status = '';
    if (ctx.license.pro && ctx.license.source === 'dev') status = 'Pro is on (developer build).';
    else if (paid && license.pro) {
      status = `Pro is active on this screen${license.customerEmail ? ` (${license.customerEmail})` : ''}: ${license.activationUsage ?? '?'} of ${license.activationLimit ?? 'unlimited'} screens used on this key.`;
    }
    $('#pro-status').textContent = status;
    if (paid && license.lastError) error.textContent = license.lastError;
    if (!paymentsConfigured()) $<HTMLButtonElement>('#license-form button[type="submit"]').title = 'License keys are not configured in this build yet';
  }
  return () => void render();
}
