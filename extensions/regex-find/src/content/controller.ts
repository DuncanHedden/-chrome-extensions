import { debounce } from '@ext/shared/dom';
import { compilePattern, findMatches, pickPrefill, MATCH_LIMIT, type Flags } from '../lib/pattern.ts';
import { resolveRange } from '../lib/text-offsets.ts';
import { historyStore, pushHistory, settingsStore, DEFAULT_SETTINGS, type Settings } from '../lib/settings.ts';
import { FindBar } from './find-bar.ts';
import { createHighlighter } from './highlighter.ts';
import { buildTextIndex, describeElement, shadowRootOf, type DocIndex } from './text-index.ts';

export interface Controller {
  focus(): void;
}

const INPUT_DEBOUNCE_MS = 150;
const MUTATION_DEBOUNCE_MS = 500;

export function createController(onClosed: () => void): Controller {
  let settings: Settings = DEFAULT_SETTINGS;
  let flags: Flags = { ...DEFAULT_SETTINGS };
  let history: string[] = [];
  let historyPos = -1;
  let draft = '';

  let index: DocIndex[] | null = null;
  let indexing: { promise: Promise<DocIndex[]>; abort: AbortController } | null = null;
  let matches: Range[] = [];
  let current = -1;
  let truncated = false;
  let searchSeq = 0;
  /** Input changed and the debounced search hasn't run yet. */
  let dirty = false;
  let closed = false;
  const observers: MutationObserver[] = [];

  const highlighter = createHighlighter(() => observers.forEach((o) => o.takeRecords()));
  const bar = new FindBar({
    onInput: () => {
      historyPos = -1;
      dirty = true;
      bar.setStatus({ kind: 'busy' });
      debouncedSearch();
    },
    onToggle: (flag) => {
      flags = { ...flags, [flag]: !flags[flag] };
      bar.setFlags(flags);
      void search();
    },
    onStep: (direction) => void step(direction),
    onHistory: browseHistory,
    onClose: close,
  });
  const debouncedSearch = debounce(() => void search(), INPUT_DEBOUNCE_MS);
  const onMutation = debounce(() => {
    invalidateIndex();
    if (bar.value) void search({ keepPosition: true });
  }, MUTATION_DEBOUNCE_MS);
  const unwatchSettings = settingsStore.watch((s) => {
    settings = s;
    highlighter.setColors(s);
  });

  bar.mount();
  void init();

  async function init() {
    [settings, { patterns: history }] = await Promise.all([settingsStore.get(), historyStore.get()]);
    if (closed) return;
    flags = { caseInsensitive: settings.caseInsensitive, multiline: settings.multiline, wholeWord: settings.wholeWord };
    bar.setFlags(flags);
    highlighter.setColors(settings);
    // Don't clobber anything typed while settings were loading.
    if (bar.value === '') {
      bar.setValue(pickPrefill(window.getSelection()?.toString() ?? '', history[0], flags));
      if (bar.value) void search();
    }
  }

  function invalidateIndex() {
    index = null;
    indexing?.abort.abort();
    indexing = null;
  }

  async function getIndex(): Promise<DocIndex[]> {
    if (index) return index;
    if (!indexing) {
      const abort = new AbortController();
      const promise = buildTextIndex(document, {
        describe: describeElement,
        shadowRootOf,
        ignore: (el) => el === bar.host,
        signal: abort.signal,
      }).then((built) => {
        if (indexing?.abort === abort) {
          index = built;
          indexing = null;
          observe(built);
        }
        return built;
      });
      indexing = { promise, abort };
    }
    return indexing.promise;
  }

  function observe(docs: DocIndex[]) {
    observers.forEach((o) => o.disconnect());
    observers.length = 0;
    const observer = new MutationObserver(() => onMutation());
    const options = { childList: true, subtree: true, characterData: true };
    for (const { doc, shadowRoots } of docs) {
      observer.observe(doc.body ?? doc.documentElement, options);
      for (const root of shadowRoots) observer.observe(root, options);
    }
    observers.push(observer);
  }

  function toDomRange(docIndex: DocIndex, start: number, end: number): Range | null {
    const resolved = resolveRange(docIndex.segments, start, end);
    if (!resolved) return null;
    try {
      const range = docIndex.doc.createRange();
      range.setStart(resolved.startNode, resolved.startOffset);
      range.setEnd(resolved.endNode, resolved.endOffset);
      // A range whose ends are in different shadow trees collapses; drop it.
      return range.collapsed ? null : range;
    } catch {
      return null; // node changed since indexing; the mutation observer will trigger a fresh search
    }
  }

  async function search({ keepPosition = false } = {}) {
    debouncedSearch.cancel();
    dirty = false;
    const seq = ++searchSeq;
    const compiled = compilePattern(bar.value, flags);
    if (!compiled || !compiled.ok) {
      setMatches([]);
      bar.setStatus(compiled ? { kind: 'error', message: compiled.error } : { kind: 'idle' });
      return;
    }

    if (!highlighter.preservesDom) {
      // The <mark> fallback rewrote the DOM; restore it and re-index from scratch.
      highlighter.clear();
      invalidateIndex();
    }
    let docs: DocIndex[];
    try {
      docs = await getIndex();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
    if (seq !== searchSeq || closed) return;

    const found: Range[] = [];
    truncated = false;
    for (const docIndex of docs) {
      const result = findMatches(docIndex.text, compiled.regex, MATCH_LIMIT - found.length);
      for (const [start, end] of result.ranges) {
        const range = toDomRange(docIndex, start, end);
        if (range) found.push(range);
      }
      if (result.truncated) {
        truncated = true;
        break;
      }
    }

    const previous = current;
    setMatches(found);
    if (!found.length) {
      bar.setStatus({ kind: 'count', current: -1, total: 0, truncated: false });
      return;
    }
    current = keepPosition && previous >= 0 ? Math.min(previous, found.length - 1) : firstInView(found);
    highlighter.setCurrent(current);
    if (!keepPosition) scrollToRange(found[current]!);
    bar.setStatus({ kind: 'count', current, total: found.length, truncated });
  }

  function setMatches(ranges: Range[]) {
    matches = ranges;
    current = -1;
    if (ranges.length) highlighter.show(ranges);
    else highlighter.clear();
  }

  async function step(direction: 1 | -1) {
    if (bar.value) saveHistory(bar.value);
    // Enter right after typing: run the pending search and land on its first match instead of skipping it.
    if (dirty) {
      await search();
      return;
    }
    if (!matches.length) return;
    current = (current + direction + matches.length) % matches.length;
    highlighter.setCurrent(current);
    scrollToRange(matches[current]!);
    bar.setStatus({ kind: 'count', current, total: matches.length, truncated });
  }

  function browseHistory(direction: 1 | -1) {
    if (!history.length) return;
    if (historyPos === -1) draft = bar.value;
    historyPos = Math.max(-1, Math.min(history.length - 1, historyPos + direction));
    bar.setValue(historyPos === -1 ? draft : history[historyPos]!);
    void search();
  }

  function saveHistory(pattern: string) {
    if (!settings.rememberHistory || compilePattern(pattern, flags)?.ok !== true || history[0] === pattern) return;
    history = pushHistory(history, pattern);
    void historyStore.set({ patterns: history });
  }

  function close() {
    if (closed) return;
    closed = true;
    if (bar.value) saveHistory(bar.value);
    debouncedSearch.cancel();
    onMutation.cancel();
    unwatchSettings();
    invalidateIndex();
    observers.forEach((o) => o.disconnect());
    const selected = matches[current];
    highlighter.destroy();
    bar.unmount();
    // Like the native find bar: leave the current match selected so it can be copied.
    if (selected && highlighter.preservesDom && selected.startContainer.ownerDocument === document) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(selected);
    }
    onClosed();
  }

  return { focus: () => bar.focus() };
}

/** First match at or below the top of the viewport, so opening the bar doesn't yank the page back to the top. */
function firstInView(ranges: Range[]): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (range.startContainer.ownerDocument !== document) break;
    if (range.getBoundingClientRect().bottom > 0) return i;
  }
  return 0;
}

function scrollToRange(range: Range) {
  const doc = range.startContainer.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return;
  // Bring enclosing same-origin iframes into view first, outermost last.
  for (let frame = win.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement ?? null) {
    frame.scrollIntoView({ block: 'nearest' });
  }
  const node = range.startContainer;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  // Handles nested scroll containers; then fine-tune the window so the match isn't under the bar.
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = range.getBoundingClientRect();
  if (rect.top < 60 || rect.bottom > win.innerHeight - 20) {
    win.scrollBy({ top: rect.top - win.innerHeight / 3, behavior: 'instant' });
  }
  if (rect.left < 0 || rect.right > win.innerWidth) {
    win.scrollBy({ left: rect.left - win.innerWidth / 3, behavior: 'instant' });
  }
}
