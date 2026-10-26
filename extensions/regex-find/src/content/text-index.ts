import { yieldToMain } from '@ext/shared/dom';
import { collapseWhitespace, type Segment } from '../lib/text-offsets.ts';

export interface ElementInfo {
  /** False for display:none (and anything inside it). */
  rendered: boolean;
  /** visibility:hidden/collapse — the box exists but its text doesn't paint. */
  hidden: boolean;
  /** Starts a new line, so text on either side shouldn't run together. */
  block: boolean;
  preserveWhitespace: boolean;
}

export interface DocIndex {
  doc: Document;
  text: string;
  segments: Segment<Text>[];
  /** Shadow roots that contributed text; highlight styles must be adopted into each. */
  shadowRoots: Set<ShadowRoot>;
}

export interface IndexOptions {
  describe(el: Element): ElementInfo;
  shadowRootOf?(el: Element): ShadowRoot | null;
  ignore?(el: Element): boolean;
  signal?: AbortSignal;
  /** Nodes to visit before yielding to the page. */
  chunkSize?: number;
}

const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'select', 'head', 'title', 'object', 'embed',
]);
const WHITESPACE_ONLY = /^[ \t\n\r\f]*$/;

// nodeType checks rather than instanceof: nodes from iframes belong to a different JS realm.
const ELEMENT = 1;
const TEXT = 3;
const FRAGMENT = 11;

/** Parent in the flat (rendered) tree: slotted nodes belong to their slot, shadow-root children to the host. */
function parentElementOf(node: Node): Element | null {
  const slot = (node as Element | Text).assignedSlot;
  if (slot) return slot;
  const parent = node.parentNode;
  if (!parent) return null;
  if (parent.nodeType === ELEMENT) return parent as Element;
  if (parent.nodeType === FRAGMENT && 'host' in parent) return (parent as ShadowRoot).host;
  return null;
}

function contentDocumentOf(frame: Element): Document | null {
  try {
    // Null (or a throw, in some embeddings) for cross-origin frames: those are skipped.
    return (frame as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
}

class DocBuilder {
  private chunks: string[] = [];
  private length = 0;
  private prevSpace = true;
  private pendingSpace = false;
  private pendingBreak = false;
  private lastBlock: Element | null | undefined;
  private infoCache = new Map<Element, ElementInfo>();
  private blockCache = new Map<Element, Element | null>();
  readonly segments: Segment<Text>[] = [];
  readonly shadowRoots = new Set<ShadowRoot>();

  constructor(
    readonly doc: Document,
    private describe: (el: Element) => ElementInfo,
  ) {}

  info(el: Element): ElementInfo {
    let info = this.infoCache.get(el);
    if (!info) this.infoCache.set(el, (info = this.describe(el)));
    return info;
  }

  private blockOf(el: Element): Element | null {
    const cached = this.blockCache.get(el);
    if (cached !== undefined) return cached;
    const block = this.info(el).block ? el : parentElementOf(el) ? this.blockOf(parentElementOf(el)!) : null;
    this.blockCache.set(el, block);
    return block;
  }

  lineBreak() {
    this.pendingBreak = true;
  }

  private emitVirtual(char: string) {
    this.chunks.push(char);
    this.length += 1;
    this.prevSpace = true;
  }

  addText(node: Text) {
    const raw = node.data;
    const parent = parentElementOf(node);
    if (!raw || !parent) return;
    const info = this.info(parent);
    if (!info.rendered || info.hidden) return;
    if (!info.preserveWhitespace && WHITESPACE_ONLY.test(raw)) {
      this.pendingSpace = true;
      return;
    }

    const block = this.blockOf(parent);
    if (this.lastBlock !== undefined && (block !== this.lastBlock || this.pendingBreak)) this.emitVirtual('\n');
    else if (this.pendingSpace && !this.prevSpace) this.emitVirtual(' ');
    this.pendingSpace = this.pendingBreak = false;
    this.lastBlock = block;

    const { text, map } = info.preserveWhitespace ? { text: raw, map: null } : collapseWhitespace(raw, this.prevSpace);
    if (!text) return;
    this.segments.push({ node, start: this.length, length: text.length, map });
    this.chunks.push(text);
    this.length += text.length;
    this.prevSpace = /\s$/.test(text);
  }

  finish(): DocIndex {
    return { doc: this.doc, text: this.chunks.join(''), segments: this.segments, shadowRoots: this.shadowRoots };
  }
}

/**
 * Walks `root` and every same-origin iframe inside it, in rendered (flat-tree) order, producing one
 * searchable string per document. Yields to the page every `chunkSize` nodes so huge pages stay responsive.
 */
export async function buildTextIndex(root: Document, opts: IndexOptions): Promise<DocIndex[]> {
  const chunkSize = opts.chunkSize ?? 2000;
  const result: DocIndex[] = [];
  const docs: Document[] = [root];
  let visited = 0;

  while (docs.length) {
    const doc = docs.shift()!;
    const start = doc.body ?? doc.documentElement;
    if (!start) continue;
    const builder = new DocBuilder(doc, opts.describe);
    const stack: Node[] = [start];

    while (stack.length) {
      if (++visited % chunkSize === 0) {
        await yieldToMain();
        opts.signal?.throwIfAborted();
      }
      const node = stack.pop()!;
      if (node.nodeType === TEXT) {
        builder.addText(node as Text);
        continue;
      }
      if (node.nodeType !== ELEMENT) continue;

      const el = node as Element;
      const name = el.localName;
      if (SKIP.has(name) || opts.ignore?.(el)) continue;
      if (name === 'br') {
        builder.lineBreak();
        continue;
      }
      if (name === 'iframe' || name === 'frame') {
        const frameDoc = contentDocumentOf(el);
        if (frameDoc && builder.info(el).rendered) docs.push(frameDoc);
        continue;
      }

      // Flat-tree order: a shadow host renders its shadow tree, and <slot>s render their assigned nodes.
      let children: ArrayLike<Node> = el.childNodes;
      const shadow = opts.shadowRootOf ? opts.shadowRootOf(el) : el.shadowRoot;
      if (shadow) {
        builder.shadowRoots.add(shadow);
        children = shadow.childNodes;
      } else if (name === 'slot') {
        const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
        if (assigned.length) children = assigned;
      }
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
    result.push(builder.finish());
  }
  return result;
}

/** Real-browser ElementInfo from computed style. Separate from the walker so tests can stub it. */
export function describeElement(el: Element): ElementInfo {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return { rendered: false, hidden: true, block: false, preserveWhitespace: false };
  const display = style.display;
  const visibleBox = (e: Element | null): boolean =>
    !e ? true : typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.getClientRects().length > 0;
  // display:contents boxes report as invisible even though their children render.
  const rendered = display === 'contents' ? visibleBox(el.parentElement) : visibleBox(el);
  const collapse = style.getPropertyValue('white-space-collapse');
  const preserveWhitespace = collapse
    ? collapse !== 'collapse' && collapse !== 'discard'
    : /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace);
  return {
    rendered,
    hidden: style.visibility !== 'visible',
    block: !/^(inline|contents|ruby)/.test(display),
    preserveWhitespace,
  };
}

/** Open shadow roots, plus closed ones on custom elements (content scripts may read those via chrome.dom). */
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  if (!el.localName.includes('-')) return null;
  try {
    return chrome.dom?.openOrClosedShadowRoot(el as HTMLElement) ?? null;
  } catch {
    return null;
  }
}
