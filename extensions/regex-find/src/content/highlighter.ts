import { safeColor, DEFAULT_SETTINGS } from '../lib/settings.ts';

export interface Colors {
  matchColor: string;
  currentColor: string;
}

export interface Highlighter {
  /** False if highlighting rewrites the DOM, which invalidates any text index built before it. */
  readonly preservesDom: boolean;
  show(ranges: Range[]): void;
  setCurrent(index: number): void;
  setColors(colors: Colors): void;
  clear(): void;
  destroy(): void;
}

const MATCH = 'regex-find-match';
const CURRENT = 'regex-find-current';

type HighlightWindow = Window & typeof globalThis;

export function createHighlighter(onDomMutated: () => void): Highlighter {
  return 'highlights' in CSS && typeof Highlight === 'function' ? new CssHighlighter() : new DomHighlighter(onDomMutated);
}

function highlightCss({ matchColor, currentColor }: Colors): string {
  const match = safeColor(matchColor, DEFAULT_SETTINGS.matchColor);
  const current = safeColor(currentColor, DEFAULT_SETTINGS.currentColor);
  return `::highlight(${MATCH}){background-color:${match};color:#000}::highlight(${CURRENT}){background-color:${current};color:#000}`;
}

/**
 * CSS Custom Highlight API: paints ranges without touching the DOM, so page scripts (React, editors,
 * etc.) never see a mutation. Styles go in via adoptedStyleSheets, which page CSP does not block.
 */
class CssHighlighter implements Highlighter {
  readonly preservesDom = true;
  private ranges: Range[] = [];
  private colors: Colors = DEFAULT_SETTINGS;
  private perWindow = new Map<HighlightWindow, { all: Highlight; current: Highlight }>();
  private sheets = new Map<Document, CSSStyleSheet>();
  private adopters = new Set<Document | ShadowRoot>();

  private highlightsFor(win: HighlightWindow) {
    let entry = this.perWindow.get(win);
    if (!entry) {
      // Each frame has its own registry, and its Highlight objects must come from that realm.
      entry = { all: new win.Highlight(), current: new win.Highlight() };
      entry.current.priority = 1;
      win.CSS.highlights.set(MATCH, entry.all);
      win.CSS.highlights.set(CURRENT, entry.current);
      this.perWindow.set(win, entry);
    }
    return entry;
  }

  private adoptStyles(doc: Document, target: Document | ShadowRoot) {
    if (this.adopters.has(target)) return;
    let sheet = this.sheets.get(doc);
    if (!sheet) {
      // Constructed sheets may only be adopted within the document whose realm created them.
      sheet = new (doc.defaultView as HighlightWindow).CSSStyleSheet();
      sheet.replaceSync(highlightCss(this.colors));
      this.sheets.set(doc, sheet);
    }
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    this.adopters.add(target);
  }

  show(ranges: Range[]) {
    this.clear();
    this.ranges = ranges;
    for (const range of ranges) {
      const doc = range.startContainer.ownerDocument!;
      const win = doc.defaultView as HighlightWindow | null;
      if (!win) continue;
      this.highlightsFor(win).all.add(range);
      this.adoptStyles(doc, doc);
      const root = range.startContainer.getRootNode();
      if (root !== doc && root.nodeType === 11) this.adoptStyles(doc, root as ShadowRoot);
    }
  }

  setCurrent(index: number) {
    for (const { current } of this.perWindow.values()) current.clear();
    const range = this.ranges[index];
    const win = range?.startContainer.ownerDocument?.defaultView as HighlightWindow | null | undefined;
    if (range && win) this.highlightsFor(win).current.add(range);
  }

  setColors(colors: Colors) {
    this.colors = colors;
    for (const sheet of this.sheets.values()) sheet.replaceSync(highlightCss(colors));
  }

  clear() {
    for (const { all, current } of this.perWindow.values()) {
      all.clear();
      current.clear();
    }
    this.ranges = [];
  }

  destroy() {
    this.clear();
    for (const [win, { all, current }] of this.perWindow) {
      if (win.CSS.highlights.get(MATCH) === all) win.CSS.highlights.delete(MATCH);
      if (win.CSS.highlights.get(CURRENT) === current) win.CSS.highlights.delete(CURRENT);
    }
    const ours = new Set<CSSStyleSheet>(this.sheets.values());
    for (const target of this.adopters) target.adoptedStyleSheets = target.adoptedStyleSheets.filter((s) => !ours.has(s));
    this.perWindow.clear();
    this.sheets.clear();
    this.adopters.clear();
  }
}

/**
 * Fallback for browsers without CSS.highlights (Chrome < 105): wraps matched text in <mark> elements and
 * fully unwraps on clear. Rewrites `ranges` in place so they keep pointing at the marked text.
 */
export class DomHighlighter implements Highlighter {
  readonly preservesDom = false;
  private marks: HTMLElement[][] = [];
  private current = -1;
  private colors: Colors = DEFAULT_SETTINGS;

  constructor(private onDomMutated: () => void = () => {}) {}

  show(ranges: Range[]) {
    this.clear();
    // Reverse order: wrapping a later match only splits off text *after* earlier matches' boundaries.
    for (let i = ranges.length - 1; i >= 0; i--) {
      const marks = this.wrap(ranges[i]!);
      this.marks[i] = marks;
      if (marks.length) {
        const range = marks[0]!.ownerDocument.createRange();
        range.setStartBefore(marks[0]!);
        range.setEndAfter(marks[marks.length - 1]!);
        ranges[i] = range;
      }
    }
    this.onDomMutated();
  }

  private wrap(range: Range): HTMLElement[] {
    const doc = range.startContainer.ownerDocument!;
    const texts: Text[] = [];
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
      texts.push(range.startContainer as Text);
    } else {
      const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) texts.push(n as Text);
    }
    const { startContainer, startOffset, endContainer, endOffset } = range;
    const marks: HTMLElement[] = [];
    for (const text of texts) {
      const from = text === startContainer ? startOffset : 0;
      const to = text === endContainer ? endOffset : text.length;
      if (from >= to) continue;
      const target = from > 0 ? text.splitText(from) : text;
      if (to - from < target.length) target.splitText(to - from);
      const mark = doc.createElement('mark');
      mark.dataset.regexFind = '';
      this.paint(mark, false);
      target.replaceWith(mark);
      mark.append(target);
      marks.push(mark);
    }
    return marks;
  }

  private paint(mark: HTMLElement, current: boolean) {
    // CSSOM writes, not style attributes, so a strict style-src CSP can't block them.
    mark.style.setProperty('background-color', current ? this.colors.currentColor : this.colors.matchColor, 'important');
    mark.style.setProperty('color', '#000', 'important');
  }

  setCurrent(index: number) {
    for (const mark of this.marks[this.current] ?? []) this.paint(mark, false);
    for (const mark of this.marks[index] ?? []) this.paint(mark, true);
    this.current = index;
  }

  setColors(colors: Colors) {
    this.colors = {
      matchColor: safeColor(colors.matchColor, DEFAULT_SETTINGS.matchColor),
      currentColor: safeColor(colors.currentColor, DEFAULT_SETTINGS.currentColor),
    };
    this.marks.forEach((marks, i) => marks.forEach((m) => this.paint(m, i === this.current)));
  }

  clear() {
    if (!this.marks.length) return;
    const parents = new Set<Node>();
    for (const marks of this.marks) {
      for (const mark of marks ?? []) {
        const parent = mark.parentNode;
        if (!parent) continue;
        mark.replaceWith(...mark.childNodes);
        parents.add(parent);
      }
    }
    for (const parent of parents) parent.normalize();
    this.marks = [];
    this.current = -1;
    this.onDomMutated();
  }

  destroy() {
    this.clear();
  }
}
