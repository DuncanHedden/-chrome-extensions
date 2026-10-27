import { h } from '@ext/shared/dom';
import { compileMatcher, DETECTOR_PRESETS } from '../engine/detectors.ts';
import type { Detector, DetectorAction, DetectorKind } from '../engine/types.ts';
import type { Ctx } from './context.ts';
import { $, newId } from './ui.ts';

const KINDS: Record<DetectorKind, string> = {
  url: 'the URL matches',
  title: 'the page title matches',
  unchanged: 'nothing changes for',
};
const ACTIONS: Record<DetectorAction, string> = {
  reload: 'reload the page',
  reopen: 'reopen the original URL',
  skip: 'skip it in the rotation',
  alert: 'only log an alert',
};

/** Origins a content check for this detector needs permission for. */
async function contentOrigins(ctx: Ctx, detector: Detector): Promise<string[]> {
  const toOrigin = (url: string) => {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? `${u.origin}/*` : null;
    } catch {
      return null;
    }
  };
  let urls: string[];
  if (detector.appliesTo) urls = [detector.appliesTo];
  else if (ctx.settings.source === 'playlist') urls = ctx.settings.playlist.map((e) => e.url);
  else urls = ctx.state.windowId === null ? [] : (await chrome.tabs.query({ windowId: ctx.state.windowId })).map((t) => t.url ?? '');
  return [...new Set(urls.map(toOrigin).filter((o): o is string => o !== null))];
}

export function initDetectors(ctx: Ctx): () => void {
  const container = $('#detectors');
  const saveAll = (detectors: Detector[], rerender = false) => ctx.save({ detectors }).then(() => rerender && render());

  const presetSelect = $<HTMLSelectElement>('#add-preset');
  presetSelect.append(...DETECTOR_PRESETS.map((p, i) => h('option', { value: String(i) }, p.name)));
  presetSelect.addEventListener('change', () => {
    const preset = DETECTOR_PRESETS[Number(presetSelect.value)];
    presetSelect.value = '';
    if (preset) void saveAll([...ctx.settings.detectors, { ...preset, id: newId() }], true);
  });
  $('#add-detector').addEventListener('click', () =>
    void saveAll([...ctx.settings.detectors, {
      id: newId(), name: 'New rule', enabled: true, kind: 'title', pattern: '', minutes: 30, checkContent: false, appliesTo: '', action: 'reload',
    }], true),
  );

  function render() {
    const detectors = ctx.settings.detectors;
    container.replaceChildren(
      ...detectors.map((d, i) => {
        const update = (patch: Partial<Detector>, rerender = false) =>
          saveAll(detectors.map((x, j) => (j === i ? { ...x, ...patch } : x)), rerender);
        const matcher = d.kind === 'unchanged' ? null : compileMatcher(d.pattern);
        const granted = h('span', { class: 'granted' });
        if (d.kind === 'unchanged' && d.checkContent) {
          void contentOrigins(ctx, d).then(async (origins) => {
            const ok = origins.length > 0 && (await chrome.permissions.contains({ permissions: ['scripting'], origins }));
            granted.textContent = ok ? `✓ allowed for ${origins.length} site${origins.length === 1 ? '' : 's'}` : 'needs permission: untick and tick again';
          });
        }
        return h('div', { class: 'detector' },
          h('div', { class: 'row' },
            h('input', { type: 'checkbox', checked: d.enabled, 'aria-label': 'Enabled', onchange: (e: Event) => void update({ enabled: (e.target as HTMLInputElement).checked }) }),
            h('input', { type: 'text', name: 'name', value: d.name, 'aria-label': 'Rule name', onchange: (e: Event) => void update({ name: (e.target as HTMLInputElement).value }) }),
            h('button', { type: 'button', class: 'icon', title: 'Remove', onclick: () => void saveAll(detectors.filter((_, j) => j !== i), true) }, '✕'),
          ),
          h('div', { class: 'row' },
            'When',
            h('select', { 'aria-label': 'Condition', onchange: (e: Event) => void update({ kind: (e.target as HTMLSelectElement).value as DetectorKind }, true) },
              ...Object.entries(KINDS).map(([k, label]) => h('option', { value: k, selected: k === d.kind }, label))),
            d.kind === 'unchanged'
              ? h('span', {}, h('input', { type: 'number', min: '1', max: '1440', value: String(d.minutes), 'aria-label': 'Minutes',
                  onchange: (e: Event) => void update({ minutes: Math.max(1, Math.round(Number((e.target as HTMLInputElement).value)) || 30) }) }), ' minutes')
              : h('input', { type: 'text', name: 'pattern', value: d.pattern, placeholder: 'text, or /regex/i', 'aria-label': 'Pattern',
                  onchange: (e: Event) => void update({ pattern: (e.target as HTMLInputElement).value }, true) }),
          ),
          matcher && !matcher.ok ? h('p', { class: 'error' }, matcher.error) : '',
          d.kind === 'unchanged'
            ? h('div', { class: 'row' },
                h('label', {}, h('input', {
                  type: 'checkbox', checked: d.checkContent,
                  onchange: async (e: Event) => {
                    const box = e.target as HTMLInputElement;
                    if (!box.checked) return void update({ checkContent: false }, true);
                    // Must be called straight from the click: Chrome only shows permission prompts for user gestures.
                    const origins = await contentOrigins(ctx, d);
                    const ok = origins.length > 0 && (await chrome.permissions.request({ permissions: ['scripting'], origins }));
                    if (!ok) box.checked = false;
                    await update({ checkContent: ok }, true);
                  },
                }), ' Also compare the page text (asks permission to read these sites)'),
                granted,
              )
            : '',
          h('div', { class: 'row' },
            'Only for URLs starting with',
            h('input', { type: 'text', value: d.appliesTo, placeholder: 'any rotated tab', size: '32', 'aria-label': 'Applies to URLs starting with',
              onchange: (e: Event) => void update({ appliesTo: (e.target as HTMLInputElement).value.trim() }) }),
          ),
          h('div', { class: 'row' },
            'Then',
            h('select', { 'aria-label': 'Action', onchange: (e: Event) => void update({ action: (e.target as HTMLSelectElement).value as DetectorAction }) },
              ...Object.entries(ACTIONS).map(([a, label]) => h('option', { value: a, selected: a === d.action }, label))),
          ),
        );
      }),
    );
  }
  return render;
}
