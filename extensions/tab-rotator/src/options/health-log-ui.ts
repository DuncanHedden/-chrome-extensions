import { h } from '@ext/shared/dom';
import { healthLogCsv } from '../csv.ts';
import { canUse } from '../pro.ts';
import { logStore } from '../engine/stores.ts';
import type { LogEntry } from '../engine/types.ts';
import type { Ctx } from './context.ts';
import { $, sendToBackground } from './ui.ts';

const FREE_ROWS = 20;

export function initHealthLog(ctx: Ctx): () => void {
  let entries: LogEntry[] = [];
  const level = $<HTMLSelectElement>('#log-level');
  const search = $<HTMLInputElement>('#log-search');

  const filtered = () => {
    if (!canUse(ctx.license, 'healthLog')) return entries.slice(-FREE_ROWS).reverse();
    const q = search.value.trim().toLowerCase();
    return entries
      .filter((e) => !level.value || (level.value === 'warn' ? e.level !== 'info' : e.level === 'error'))
      .filter((e) => !q || `${e.message} ${e.code} ${e.url ?? ''}`.toLowerCase().includes(q))
      .reverse();
  };

  function render() {
    const rows = filtered();
    $('#log').replaceChildren(
      ...rows.map((e) =>
        h('tr', { class: e.level },
          h('td', {}, h('time', { datetime: new Date(e.at).toISOString() }, new Date(e.at).toLocaleString())),
          h('td', { title: e.code }, e.message),
          h('td', {}, e.url ?? ''),
        ),
      ),
    );
    $('#log-empty').hidden = rows.length > 0;
    $('#log-count').textContent = `${rows.length.toLocaleString()} of ${entries.length.toLocaleString()} events`;
  }

  level.addEventListener('change', render);
  search.addEventListener('input', render);
  $('#log-export').addEventListener('click', () => {
    const blob = new Blob([healthLogCsv(entries)], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tab-rotator-health-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $('#log-clear').addEventListener('click', () => {
    if (confirm('Clear the health log on this screen? This cannot be undone.')) void sendToBackground('clearLog');
  });

  void logStore.get().then((l) => {
    entries = l.entries;
    render();
  });
  logStore.watch((l) => {
    entries = l.entries;
    render();
  });
  return render;
}
