// Small helpers shared by the options page modules.
export const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

let savedTimer: ReturnType<typeof setTimeout> | undefined;
export function flashSaved(text = 'Saved') {
  const el = $('#saved');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

export const newId = () => crypto.randomUUID();

export const sendToBackground = (type: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ target: 'background', type, ...extra });
