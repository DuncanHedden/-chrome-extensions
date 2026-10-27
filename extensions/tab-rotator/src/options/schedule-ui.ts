import { h } from '@ext/shared/dom';
import { isValidTimeZone, isWithinSchedule, parseTime } from '../engine/schedule.ts';
import type { Schedule, ScheduleWindow } from '../engine/types.ts';
import type { Ctx } from './context.ts';
import { renderList } from './list-editor.ts';
import { $, newId } from './ui.ts';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function initSchedule(ctx: Ctx): () => void {
  const saveSchedule = (patch: Partial<Schedule>) => ctx.save({ schedule: { ...ctx.settings.schedule, ...patch } });
  const saveWindows = (windows: ScheduleWindow[], rerender = false) =>
    saveSchedule({ windows }).then(() => rerender && render());

  $<HTMLInputElement>('#schedule-enabled').addEventListener('change', (e) =>
    void saveSchedule({ enabled: (e.target as HTMLInputElement).checked }).then(render),
  );
  $('#add-window').addEventListener('click', () =>
    void saveWindows([...ctx.settings.schedule.windows, { id: newId(), days: [1, 2, 3, 4, 5], start: '07:00', end: '18:00' }], true),
  );
  const tz = $<HTMLInputElement>('#schedule-tz');
  tz.addEventListener('change', () => {
    const value = tz.value.trim();
    $('#schedule-tz-error').textContent = isValidTimeZone(value) ? '' : 'Unknown time zone; using this computer’s.';
    void saveSchedule({ timeZone: value }).then(render);
  });
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  $('#time-zones').replaceChildren(...zones.map((z) => h('option', { value: z })));
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="offHoursKind"]')) {
    radio.addEventListener('change', () =>
      void saveSchedule({ offHours: { ...ctx.settings.schedule.offHours, kind: radio.value as Schedule['offHours']['kind'] } }).then(render),
    );
  }
  $<HTMLInputElement>('#off-hours-url').addEventListener('change', (e) =>
    void saveSchedule({ offHours: { ...ctx.settings.schedule.offHours, url: (e.target as HTMLInputElement).value.trim(), kind: 'page' } }).then(render),
  );

  function render() {
    const schedule = ctx.settings.schedule;
    $<HTMLInputElement>('#schedule-enabled').checked = schedule.enabled;
    tz.value = schedule.timeZone;
    tz.placeholder = `This computer’s (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;

    $('#schedule-windows').replaceChildren(
      ...schedule.windows.map((w, i) => {
        const update = (patch: Partial<ScheduleWindow>, rerender = false) =>
          saveWindows(schedule.windows.map((x, j) => (j === i ? { ...x, ...patch } : x)), rerender);
        const start = parseTime(w.start);
        const end = parseTime(w.end);
        const note = start === null || end === null ? '' : start === end ? 'all day' : end < start ? 'runs past midnight' : '';
        return h('div', { class: 'window-row' },
          h('span', { class: 'days' }, ...DAY_ORDER.map((d) =>
            h('label', {}, h('input', {
              type: 'checkbox', checked: w.days.includes(d),
              onchange: (e: Event) => {
                const on = (e.target as HTMLInputElement).checked;
                void update({ days: on ? [...w.days, d].sort() : w.days.filter((x) => x !== d) });
              },
            }), DAY_NAMES[d]!),
          )),
          h('input', { type: 'time', value: w.start, 'aria-label': 'From', onchange: (e: Event) => void update({ start: (e.target as HTMLInputElement).value }, true) }),
          '–',
          h('input', { type: 'time', value: w.end, 'aria-label': 'Until', onchange: (e: Event) => void update({ end: (e.target as HTMLInputElement).value }, true) }),
          h('span', { class: 'hint' }, note),
          h('button', { type: 'button', class: 'icon', title: 'Remove', onclick: () => void saveWindows(schedule.windows.filter((_, j) => j !== i), true) }, '✕'),
        );
      }),
    );

    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="offHoursKind"]')) {
      radio.checked = radio.value === schedule.offHours.kind;
    }
    $<HTMLInputElement>('#off-hours-url').value = schedule.offHours.url;
    const playlist = $('#off-hours-playlist');
    playlist.hidden = schedule.offHours.kind !== 'playlist';
    renderList(playlist, schedule.offHours.entries, {
      urlField: 'url',
      urlLabel: 'URL',
      placeholder: 'https://intranet.example/news',
      addLabel: 'Add URL',
      defaultDurationSec: () => ctx.settings.defaultDurationSec,
      onChange: (entries) => saveSchedule({ offHours: { ...ctx.settings.schedule.offHours, entries } }),
    });

    const inside = isWithinSchedule({ ...schedule, enabled: true }, Date.now());
    $('#schedule-now').textContent = schedule.windows.length
      ? `Right now is ${inside ? 'inside' : 'outside'} these hours.`
      : 'No hours set: the screen would always be off. Add hours above.';
  }

  return render;
}
