import { h } from '@ext/shared/dom';
import { clampDuration } from '../engine/defaults.ts';
import type { DisplaySettings } from '../engine/types.ts';
import { $, newId } from './ui.ts';

export type Row = DisplaySettings & { id: string; url?: string; urlPrefix?: string };

interface ListOptions<R extends Row> {
  /** Which property holds the URL text ("url" for playlists, "urlPrefix" for rules). */
  urlField: 'url' | 'urlPrefix';
  urlLabel: string;
  placeholder: string;
  addLabel: string;
  defaultDurationSec: () => number;
  onChange: (rows: R[]) => void | Promise<void>;
}

/** Editable table of URL rows (playlist entries or per-tab rules): edit, reorder, remove, add. */
export function renderList<R extends Row>(container: HTMLElement, rows: R[], options: ListOptions<R>) {
  const change = async (next: R[], rerender = false) => {
    await options.onChange(next);
    if (rerender) renderList(container, next, options);
  };
  const update = (i: number, patch: Partial<R>) => change(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row!);
    void change(next, true);
  };

  const tbody = h(
    'tbody',
    {},
    ...rows.map((row, i) =>
      h(
        'tr',
        {},
        h('td', {}, h('input', {
          type: options.urlField === 'url' ? 'url' : 'text',
          value: String(row[options.urlField] ?? ''),
          placeholder: options.placeholder,
          'aria-label': options.urlLabel,
          onchange: (e: Event) => void update(i, { [options.urlField]: (e.target as HTMLInputElement).value.trim() } as Partial<R>),
        })),
        h('td', {}, h('input', {
          type: 'number', min: '2', step: '1', 'aria-label': 'Seconds',
          value: row.durationSec === null ? '' : String(row.durationSec),
          placeholder: String(options.defaultDurationSec()),
          onchange: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            void update(i, { durationSec: raw === '' ? null : clampDuration(Number(raw)) } as Partial<R>);
          },
        })),
        h('td', {}, h('input', {
          type: 'checkbox', checked: row.reloadBeforeShow, 'aria-label': 'Reload before showing',
          onchange: (e: Event) => void update(i, { reloadBeforeShow: (e.target as HTMLInputElement).checked } as Partial<R>),
        })),
        h('td', {},
          h('button', { type: 'button', class: 'icon', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { type: 'button', class: 'icon', title: 'Move down', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { type: 'button', class: 'icon', title: 'Remove', onclick: () => void change(rows.filter((_, j) => j !== i), true) }, '✕'),
        ),
      ),
    ),
  );
  const add = () => {
    const row = { id: newId(), [options.urlField]: '', durationSec: null, reloadBeforeShow: false } as unknown as R;
    void change([...rows, row], true).then(() => $<HTMLInputElement>('tr:last-child input', container).focus());
  };
  container.replaceChildren(
    h('table', { class: 'items' },
      h('thead', {}, h('tr', {}, h('th', {}, options.urlLabel), h('th', {}, 'Seconds'), h('th', {}, 'Reload before showing'), h('th', {}))),
      tbody,
    ),
    h('button', { type: 'button', onclick: add }, options.addLabel),
  );
}
