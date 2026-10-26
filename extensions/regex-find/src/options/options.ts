import { historyStore, settingsStore, DEFAULT_SETTINGS, DONATE_URL, type Settings } from '../lib/settings.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (name: keyof Settings) => $<HTMLInputElement>(`input[name="${name}"]`);
const BOOLEAN_FIELDS = ['caseInsensitive', 'wholeWord', 'multiline', 'rememberHistory'] as const;
const COLOR_FIELDS = ['matchColor', 'currentColor'] as const;

let savedTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved() {
  const el = $('#saved');
  el.textContent = 'Saved';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function renderSettings(settings: Settings) {
  for (const name of BOOLEAN_FIELDS) input(name).checked = settings[name];
  for (const name of COLOR_FIELDS) input(name).value = settings[name];
  $('#preview-match').style.backgroundColor = settings.matchColor;
  $('#preview-current').style.backgroundColor = settings.currentColor;
}

function renderHistory(patterns: string[]) {
  $('#history').replaceChildren(
    ...patterns.map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }),
  );
  $('#history-empty').hidden = patterns.length > 0;
  $<HTMLButtonElement>('#clear-history').disabled = patterns.length === 0;
}

async function renderShortcut() {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'open-find-bar')?.shortcut;
  $('#shortcut').textContent = shortcut || 'not set';
}

async function main() {
  renderSettings(await settingsStore.get());
  renderHistory((await historyStore.get()).patterns);
  await renderShortcut();

  for (const name of BOOLEAN_FIELDS) {
    input(name).addEventListener('change', async (e) => {
      await settingsStore.set({ [name]: (e.target as HTMLInputElement).checked });
      if (name === 'rememberHistory' && !(e.target as HTMLInputElement).checked) await historyStore.set({ patterns: [] });
      flashSaved();
    });
  }
  for (const name of COLOR_FIELDS) {
    input(name).addEventListener('change', async (e) => {
      await settingsStore.set({ [name]: (e.target as HTMLInputElement).value });
      flashSaved();
    });
  }
  $('#reset-colors').addEventListener('click', async () => {
    await settingsStore.set({ matchColor: DEFAULT_SETTINGS.matchColor, currentColor: DEFAULT_SETTINGS.currentColor });
    flashSaved();
  });
  $('#clear-history').addEventListener('click', async () => {
    await historyStore.set({ patterns: [] });
    flashSaved();
  });
  // chrome:// URLs can't be opened from a link, but tabs.create works (and needs no "tabs" permission).
  $('#change-shortcut').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  // The shortcut can change while this page is open; refresh when the user comes back to it.
  window.addEventListener('focus', () => void renderShortcut());

  settingsStore.watch(renderSettings);
  historyStore.watch(({ patterns }) => renderHistory(patterns));

  $<HTMLAnchorElement>('#donate').href = DONATE_URL;
  $('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
}

void main();
