/**
 * A run of searchable text backed by one DOM text node.
 *
 * The searchable string for a document is the concatenation of segments plus "virtual" characters that
 * exist in no node: "\n" between block elements and " " for collapsed inter-element whitespace. Within a
 * segment, whitespace may be collapsed, in which case `map[i]` is the node offset of the i-th char.
 */
export interface Segment<N> {
  node: N;
  start: number;
  length: number;
  map: Int32Array | null;
}

export interface ResolvedRange<N> {
  startNode: N;
  startOffset: number;
  endNode: N;
  endOffset: number;
}

const WHITESPACE = /[ \t\n\r\f]/;

/** Collapses runs of HTML whitespace to one space, as rendering does. `prevSpace` drops a leading space. */
export function collapseWhitespace(raw: string, prevSpace: boolean): { text: string; map: Int32Array | null } {
  if (!/[\t\n\r\f]| {2}/.test(raw) && !(prevSpace && raw[0] === ' ')) return { text: raw, map: null };
  const map = new Int32Array(raw.length);
  let text = '';
  let space = prevSpace;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (WHITESPACE.test(c)) {
      if (space) continue;
      space = true;
      map[text.length] = i;
      text += ' ';
    } else {
      space = false;
      map[text.length] = i;
      text += c;
    }
  }
  return { text, map: map.subarray(0, text.length) };
}

/** Index of the last segment starting at or before `offset`, or -1. */
export function segmentIndexAt<N>(segments: readonly Segment<N>[], offset: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

const nodeOffset = <N>(seg: Segment<N>, local: number) => (seg.map ? seg.map[local]! : local);

/**
 * Maps a [start, end) match in the searchable string back to DOM positions.
 * Boundaries that fall on virtual characters snap inward to the nearest real text.
 * Returns null if the match covers only virtual characters.
 */
export function resolveRange<N>(segments: readonly Segment<N>[], start: number, end: number): ResolvedRange<N> | null {
  if (end <= start) return null;

  let si = segmentIndexAt(segments, start);
  let startOffset: number;
  if (si >= 0 && start < segments[si]!.start + segments[si]!.length) {
    startOffset = nodeOffset(segments[si]!, start - segments[si]!.start);
  } else {
    si++; // start is on a virtual char: snap forward to the next segment
    if (si >= segments.length) return null;
    startOffset = nodeOffset(segments[si]!, 0);
  }

  const last = end - 1;
  const ei = segmentIndexAt(segments, last);
  if (ei < 0) return null;
  const endSeg = segments[ei]!;
  // If the last char is virtual, snap back to the end of the preceding segment.
  const local = Math.min(last - endSeg.start, endSeg.length - 1);
  const endOffset = nodeOffset(endSeg, local) + 1;

  if (ei < si || (ei === si && endOffset <= startOffset)) return null;
  return { startNode: segments[si]!.node, startOffset, endNode: endSeg.node, endOffset };
}
