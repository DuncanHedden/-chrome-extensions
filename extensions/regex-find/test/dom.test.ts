// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { compilePattern, findMatches } from '../src/lib/pattern.ts';
import { resolveRange } from '../src/lib/text-offsets.ts';
import { DomHighlighter } from '../src/content/highlighter.ts';
import { buildTextIndex, type DocIndex, type ElementInfo } from '../src/content/text-index.ts';

// jsdom has no layout, so describe elements from tag names and inline styles instead of computed style.
const BLOCK = new Set(['div', 'p', 'li', 'ul', 'h1', 'td', 'tr', 'table', 'tbody', 'pre', 'body', 'section']);
function describe_(el: Element): ElementInfo {
  const style = (el as HTMLElement).style;
  const hiddenAncestor = el.closest('[data-hidden]') !== null;
  return {
    rendered: style?.display !== 'none' && !hiddenAncestor,
    hidden: style?.visibility === 'hidden',
    block: BLOCK.has(el.localName),
    preserveWhitespace: el.closest('pre') !== null,
  };
}

async function index(html: string): Promise<DocIndex> {
  document.body.innerHTML = html;
  const [doc] = await buildTextIndex(document, { describe: describe_, chunkSize: 3 });
  return doc!;
}

function search(doc: DocIndex, pattern: string) {
  const compiled = compilePattern(pattern, { caseInsensitive: false, multiline: true, wholeWord: false });
  if (!compiled?.ok) throw new Error();
  return findMatches(doc.text, compiled.regex).ranges.map(([s, e]) => {
    const r = resolveRange(doc.segments, s, e)!;
    const range = document.createRange();
    range.setStart(r.startNode, r.startOffset);
    range.setEnd(r.endNode, r.endOffset);
    return range;
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildTextIndex', () => {
  it('joins inline elements and separates blocks with a newline', async () => {
    const doc = await index('<p>Hello <b>wor</b>ld</p><p>next</p><div>a<br>b</div>');
    expect(doc.text).toBe('Hello world\nnext\na\nb');
  });

  it('collapses source whitespace like rendering does', async () => {
    const doc = await index('<p>\n    Hello\n    world   </p>\n\n<p>  again</p>');
    expect(doc.text).toBe('Hello world \nagain');
  });

  it('keeps whitespace inside <pre>', async () => {
    const doc = await index('<pre>a  b\n  c</pre>');
    expect(doc.text).toBe('a  b\n  c');
  });

  it('keeps a single space between inline siblings separated by whitespace-only text', async () => {
    const doc = await index('<p><b>foo</b>\n   <i>bar</i></p>');
    expect(doc.text).toBe('foo bar');
  });

  it('skips scripts, styles, form controls, display:none and visibility:hidden', async () => {
    const doc = await index(
      '<p>keep</p><script>var x</script><style>p{}</style><textarea>no</textarea>' +
        '<div style="display:none">gone</div><div data-hidden><span>gone too</span></div>' +
        '<span style="visibility:hidden">invisible</span><p>end</p>',
    );
    expect(doc.text).toBe('keep\nend');
  });

  it('walks open shadow roots in flat-tree order, including slotted content', async () => {
    document.body.innerHTML = '<p>before</p><div id="host"><span>slotted</span></div><p>after</p>';
    const host = document.getElementById('host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<div>shadow-start <slot></slot> shadow-end</div>';
    const [doc] = await buildTextIndex(document, { describe: describe_ });
    expect(doc!.text).toBe('before\nshadow-start slotted shadow-end\nafter');
    expect(doc!.shadowRoots.size).toBe(1);
  });

  it('honours ignore() for our own UI', async () => {
    document.body.innerHTML = '<p>page</p><regex-find-bar>bar text</regex-find-bar>';
    const [doc] = await buildTextIndex(document, { describe: describe_, ignore: (el) => el.localName === 'regex-find-bar' });
    expect(doc!.text).toBe('page');
  });

  it('stops when aborted', async () => {
    document.body.innerHTML = '<p>x</p>'.repeat(50);
    const abort = new AbortController();
    const pending = buildTextIndex(document, { describe: describe_, chunkSize: 5, signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('matches map back to DOM ranges', () => {
  it('produces ranges whose text equals the match, across element boundaries', async () => {
    const doc = await index('<p>The <em>quick</em> brown\n   fox</p><p>quick2</p>');
    expect(search(doc, 'qu\\w+').map(String)).toEqual(['quick', 'quick2']);
    // Range#toString returns raw DOM text, so collapsed whitespace shows up as-is.
    expect(search(doc, 'brown fox').map(String)).toEqual(['brown\n   fox']);
    expect(search(doc, 'e quick b').map(String)).toEqual(['e quick b']);
  });

  it('anchors ^ and $ at block boundaries with the multiline flag', async () => {
    const doc = await index('<li>apple pie</li><li>banana</li><li>apple</li>');
    expect(search(doc, '^apple$').map(String)).toEqual(['apple']);
  });
});

describe('DomHighlighter (fallback)', () => {
  it('wraps matches in <mark> and restores the original DOM exactly on clear', async () => {
    const html = '<p>one <b>two</b> three two</p><p>two</p>';
    const doc = await index(html);
    const ranges = search(doc, 'ne tw|thr\\w+|two$');
    expect(ranges).toHaveLength(4);

    const highlighter = new DomHighlighter();
    highlighter.show(ranges);
    expect(document.querySelectorAll('mark[data-regex-find]').length).toBe(5); // "ne tw" spans two text nodes
    expect(document.body.textContent).toBe('one two three twotwo');
    expect(document.querySelector('b')!.innerHTML).toBe('<mark data-regex-find="" style="background-color: rgb(255, 235, 59) !important; color: rgb(0, 0, 0) !important;">tw</mark>o');
    // Ranges are rewritten to cover the marks, so they still read as the match.
    expect(ranges.map(String)).toEqual(['ne tw', 'three', 'two', 'two']);

    highlighter.setCurrent(1);
    const bg = (text: string) =>
      [...document.querySelectorAll('mark')].find((m) => m.textContent === text)!.style.backgroundColor;
    expect(bg('three')).toBe('rgb(255, 150, 50)');
    expect(bg('tw')).toBe('rgb(255, 235, 59)');

    highlighter.clear();
    expect(document.body.innerHTML).toBe(html);
  });
});
