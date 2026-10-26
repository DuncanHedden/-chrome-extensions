/**
 * Looks up a string from the extension's _locales/<lang>/messages.json.
 * Falls back to `fallback` (or the key) so a missing translation never renders blank.
 */
export function t(key: string, substitutions?: string | string[], fallback?: string): string {
  const message = globalThis.chrome?.i18n?.getMessage(key, substitutions);
  return message || fallback || key;
}

/** Replaces the text of every `[data-i18n="key"]` element under `root`. */
export function localizeDom(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n!, undefined, el.textContent ?? undefined);
  }
}
