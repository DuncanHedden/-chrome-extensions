import { describe, expect, it } from 'vitest';
import { collapseWhitespace, resolveRange, segmentIndexAt, type Segment } from '../src/lib/text-offsets.ts';

describe('collapseWhitespace', () => {
  it('is the identity (no map) when nothing collapses', () => {
    expect(collapseWhitespace('hello world', false)).toEqual({ text: 'hello world', map: null });
  });

  it('collapses runs and newlines to one space, mapping back to original offsets', () => {
    const { text, map } = collapseWhitespace('a \n  b\tc', false);
    expect(text).toBe('a b c');
    expect(Array.from(map!)).toEqual([0, 1, 5, 6, 7]);
  });

  it('drops leading whitespace after a preceding space', () => {
    const { text, map } = collapseWhitespace('  x', true);
    expect(text).toBe('x');
    expect(Array.from(map!)).toEqual([2]);
  });

  it('does not collapse non-breaking spaces', () => {
    expect(collapseWhitespace('a  b', false).text).toBe('a  b');
  });
});

// Searchable text: "foo" + "\n" (virtual) + "ba r" (collapsed from "ba   r") + "baz"
// offsets:          0..3     3              4..8                               8..11
const segs: Segment<string>[] = [
  { node: 'A', start: 0, length: 3, map: null },
  { node: 'B', start: 4, length: 4, map: Int32Array.from([0, 1, 2, 5]) },
  { node: 'C', start: 8, length: 3, map: null },
];

describe('segmentIndexAt', () => {
  it('finds the last segment starting at or before an offset', () => {
    expect(segmentIndexAt(segs, 0)).toBe(0);
    expect(segmentIndexAt(segs, 3)).toBe(0); // virtual char after "foo"
    expect(segmentIndexAt(segs, 4)).toBe(1);
    expect(segmentIndexAt(segs, 10)).toBe(2);
    expect(segmentIndexAt([], 0)).toBe(-1);
  });
});

describe('resolveRange', () => {
  it('maps a match inside one segment', () => {
    expect(resolveRange(segs, 1, 3)).toEqual({ startNode: 'A', startOffset: 1, endNode: 'A', endOffset: 3 });
  });

  it('maps through collapsed whitespace', () => {
    // "a r" in "ba r" -> node offsets 1..6 in "ba   r"
    expect(resolveRange(segs, 5, 8)).toEqual({ startNode: 'B', startOffset: 1, endNode: 'B', endOffset: 6 });
  });

  it('spans segments', () => {
    expect(resolveRange(segs, 6, 10)).toEqual({ startNode: 'B', startOffset: 2, endNode: 'C', endOffset: 2 });
  });

  it('snaps boundaries on virtual chars inward', () => {
    // "oo\nba": start in A, end in B; "\nba" starts on the virtual newline -> snaps to B
    expect(resolveRange(segs, 1, 6)).toEqual({ startNode: 'A', startOffset: 1, endNode: 'B', endOffset: 2 });
    expect(resolveRange(segs, 3, 6)).toEqual({ startNode: 'B', startOffset: 0, endNode: 'B', endOffset: 2 });
    expect(resolveRange(segs, 2, 4)).toEqual({ startNode: 'A', startOffset: 2, endNode: 'A', endOffset: 3 });
  });

  it('returns null for matches made only of virtual characters', () => {
    expect(resolveRange(segs, 3, 4)).toBeNull();
    expect(resolveRange(segs, 2, 2)).toBeNull();
  });
});
