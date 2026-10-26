import { h } from '@ext/shared/dom';
import { t } from '@ext/shared/i18n';
import type { Flags } from '../lib/pattern.ts';

export type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'count'; current: number; total: number; truncated: boolean };

export interface FindBarHandlers {
  onInput(): void;
  onToggle(flag: keyof Flags): void;
  onStep(direction: 1 | -1): void;
  onHistory(direction: 1 | -1): void;
  onClose(): void;
}

const CSS = `
:host { all: initial; position: fixed; top: 8px; right: 16px; z-index: 2147483647; }
.bar {
  --bg: #fff; --fg: #202124; --muted: #5f6368; --border: #dadce0; --accent: #1a73e8; --error: #d93025; --pressed: #e8f0fe;
  display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 10px; max-width: calc(100vw - 32px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.2); font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  .bar { --bg: #292a2d; --fg: #e8eaed; --muted: #9aa0a6; --border: #5f6368; --accent: #8ab4f8; --error: #f28b82; --pressed: #394457; }
}
input {
  width: 240px; min-width: 80px; flex: 1; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: inherit; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; outline: none;
}
input:focus { border-color: var(--accent); }
input[aria-invalid="true"] { border-color: var(--error); }
.status { min-width: 72px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.error { color: var(--error); max-width: 220px; }
button {
  all: unset; box-sizing: border-box; min-width: 26px; height: 26px; padding: 0 5px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--muted);
  font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
button:hover { background: var(--pressed); color: var(--fg); }
button:focus-visible { outline: 2px solid var(--accent); }
button[aria-pressed="true"] { background: var(--pressed); color: var(--accent); }
.sep { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
`;

const FLAG_BUTTONS: Array<{ flag: keyof Flags; label: string; key: string; title: string }> = [
  { flag: 'caseInsensitive', label: 'Aa', key: 'KeyC', title: 'flagMatchCase' },
  { flag: 'wholeWord', label: '\\b', key: 'KeyW', title: 'flagWholeWord' },
  { flag: 'multiline', label: '^$', key: 'KeyM', title: 'flagMultiline' },
];

const FALLBACK_TITLES: Record<string, string> = {
  flagMatchCase: 'Match case (Alt+C)',
  flagWholeWord: 'Whole word (Alt+W)',
  flagMultiline: 'Multiline: ^ and $ match at each line (Alt+M)',
};

/** The injected find bar. Lives in a closed shadow root so page CSS and scripts can't reach into it. */
export class FindBar {
  readonly host: HTMLElement;
  private input: HTMLInputElement;
  private status: HTMLElement;
  private flagButtons = new Map<keyof Flags, HTMLButtonElement>();

  constructor(handlers: FindBarHandlers) {
    this.host = document.createElement('regex-find-bar');
    const root = this.host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    this.input = h('input', {
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: t('barPlaceholder', undefined, 'Regular expression'),
      'aria-label': t('barPlaceholder', undefined, 'Regular expression'),
      oninput: () => handlers.onInput(),
    });
    this.status = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' });

    const flagEls = FLAG_BUTTONS.map(({ flag, label, title }) => {
      const button = h('button', { title: t(title, undefined, FALLBACK_TITLES[title]), 'aria-pressed': 'false', onclick: () => handlers.onToggle(flag) }, label);
      this.flagButtons.set(flag, button);
      return button;
    });

    const bar = h(
      'div',
      { class: 'bar', role: 'search' },
      this.input,
      this.status,
      ...flagEls,
      h('span', { class: 'sep' }),
      h('button', { title: t('barPrev', undefined, 'Previous match (Shift+Enter)'), onclick: () => handlers.onStep(-1) }, '↑'),
      h('button', { title: t('barNext', undefined, 'Next match (Enter)'), onclick: () => handlers.onStep(1) }, '↓'),
      h('button', { title: t('barClose', undefined, 'Close (Esc)'), onclick: () => handlers.onClose() }, '✕'),
    );
    root.append(bar);

    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handlers.onClose();
      } else if (e.key === 'Enter' && e.target === this.input) {
        e.preventDefault();
        handlers.onStep(e.shiftKey ? -1 : 1);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target === this.input) {
        e.preventDefault();
        handlers.onHistory(e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const button = FLAG_BUTTONS.find((b) => b.key === e.code);
        if (button) {
          e.preventDefault();
          handlers.onToggle(button.flag);
        }
      }
    });
    // Keep keystrokes in the bar from triggering the page's own keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput']) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  mount() {
    // documentElement rather than body: some apps replace <body> wholesale.
    document.documentElement.append(this.host);
    this.focus();
  }

  unmount() {
    this.host.remove();
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  get value() {
    return this.input.value;
  }

  setValue(value: string) {
    this.input.value = value;
    this.input.select();
  }

  setFlags(flags: Flags) {
    for (const [flag, button] of this.flagButtons) {
      // The "Aa" button reads as "match case", i.e. the inverse of the caseInsensitive flag.
      const pressed = flag === 'caseInsensitive' ? !flags[flag] : flags[flag];
      button.setAttribute('aria-pressed', String(pressed));
    }
  }

  setStatus(status: Status) {
    this.input.setAttribute('aria-invalid', String(status.kind === 'error'));
    this.status.classList.toggle('error', status.kind === 'error');
    this.status.title = '';
    switch (status.kind) {
      case 'idle':
        this.status.textContent = '';
        break;
      case 'busy':
        this.status.textContent = '…';
        break;
      case 'error':
        this.status.textContent = status.message;
        this.status.title = status.message;
        break;
      case 'count': {
        if (status.total === 0) {
          this.status.textContent = t('statusNoMatches', undefined, 'No matches');
          break;
        }
        const total = status.total.toLocaleString() + (status.truncated ? '+' : '');
        this.status.textContent = t('statusCount', [String(status.current + 1), total], `${status.current + 1} of ${total}`);
        if (status.truncated) {
          this.status.title = t('statusTruncated', [status.total.toLocaleString()], `Showing the first ${status.total.toLocaleString()} matches. Narrow the pattern to see the rest.`);
        }
      }
    }
  }
}
