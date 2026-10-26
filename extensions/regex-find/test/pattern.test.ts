import { describe, expect, it } from 'vitest';
import { compilePattern, escapeRegExp, findMatches, pickPrefill, type Flags } from '../src/lib/pattern.ts';
import { pushHistory, safeColor } from '../src/lib/settings.ts';

const flags = (f: Partial<Flags> = {}): Flags => ({ caseInsensitive: false, multiline: false, wholeWord: false, ...f });
const run = (pattern: string, text: string, f?: Partial<Flags>, limit?: number) => {
  const compiled = compilePattern(pattern, flags(f));
  if (!compiled?.ok) throw new Error('expected valid pattern');
  return findMatches(text, compiled.regex, limit);
};
const texts = (pattern: string, text: string, f?: Partial<Flags>) =>
  run(pattern, text, f).ranges.map(([s, e]) => text.slice(s, e));

describe('compilePattern', () => {
  it('returns null for an empty pattern', () => {
    expect(compilePattern('', flags())).toBeNull();
  });

  it('reports invalid regexes without throwing, with the V8 prefix stripped', () => {
    expect(compilePattern('(', flags())).toEqual({ ok: false, error: 'Unterminated group' });
    expect(compilePattern('[a-', flags())).toMatchObject({ ok: false });
    expect(compilePattern('a{2,1}', flags())).toMatchObject({ ok: false });
  });

  it('applies flags', () => {
    expect(texts('foo', 'Foo foo FOO')).toEqual(['foo']);
    expect(texts('foo', 'Foo foo FOO', { caseInsensitive: true })).toEqual(['Foo', 'foo', 'FOO']);
    expect(texts('^b', 'a\nb\nb')).toEqual([]);
    expect(texts('^b', 'a\nb\nb', { multiline: true })).toEqual(['b', 'b']);
  });

  it('implements whole-word by wrapping in \\b, preserving alternation', () => {
    expect(texts('cat|dog', 'cat concatenate dogma dog', { wholeWord: true })).toEqual(['cat', 'dog']);
  });
});

describe('findMatches', () => {
  it('returns half-open offsets in order', () => {
    expect(run('\\d+', 'a1 b22 c333').ranges).toEqual([[1, 2], [4, 6], [8, 11]]);
  });

  it('skips empty matches instead of looping forever', () => {
    expect(texts('x*', 'axxbx')).toEqual(['xx', 'x']);
    expect(run('^', 'abc', { multiline: true }).ranges).toEqual([]);
  });

  it('caps at the limit and reports truncation only when more matches exist', () => {
    expect(run('a', 'aaaa', {}, 4)).toEqual({ ranges: [[0, 1], [1, 2], [2, 3], [3, 4]], truncated: false });
    const capped = run('a', 'aaaaa', {}, 4);
    expect(capped.ranges).toHaveLength(4);
    expect(capped.truncated).toBe(true);
    expect(run('a', 'a', {}, 0)).toEqual({ ranges: [], truncated: true });
  });

  it('resets lastIndex so a regex can be reused', () => {
    const compiled = compilePattern('a', flags());
    if (!compiled?.ok) throw new Error();
    findMatches('aaa', compiled.regex);
    expect(findMatches('aaa', compiled.regex).ranges).toHaveLength(3);
  });
});

describe('escapeRegExp / pickPrefill', () => {
  it('escapes every metacharacter', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p';
    expect(new RegExp(escapeRegExp(raw)).exec(raw)?.[0]).toBe(raw);
  });

  it('prefers a fresh selection, escaped', () => {
    expect(pickPrefill('price: $5', 'foo', flags())).toBe('price: \\$5');
  });

  it("keeps the last pattern when the selection is that pattern's own match", () => {
    expect(pickPrefill('2024-01-02', '\\d{4}-\\d\\d-\\d\\d', flags())).toBe('\\d{4}-\\d\\d-\\d\\d');
  });

  it('ignores long or multi-line selections', () => {
    expect(pickPrefill('line one\nline two', 'last', flags())).toBe('last');
    expect(pickPrefill('x'.repeat(201), undefined, flags())).toBe('');
  });
});

describe('settings helpers', () => {
  it('pushHistory dedupes to the front and caps', () => {
    expect(pushHistory(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(pushHistory(['1', '2', '3'], '0', 3)).toEqual(['0', '1', '2']);
  });

  it('safeColor only lets #rrggbb through', () => {
    expect(safeColor('#A1b2C3', '#000000')).toBe('#A1b2C3');
    expect(safeColor('red;}body{display:none', '#000000')).toBe('#000000');
  });
});
