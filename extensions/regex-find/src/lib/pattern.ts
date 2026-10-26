export interface Flags {
  caseInsensitive: boolean;
  multiline: boolean;
  wholeWord: boolean;
}

export type CompileResult = { ok: true; regex: RegExp } | { ok: false; error: string };

/** Hard cap across all frames; beyond this, highlighting and counting stop and the bar says so. */
export const MATCH_LIMIT = 5000;

/** Returns null for an empty pattern. Never throws: invalid input comes back as `{ ok: false }`. */
export function compilePattern(source: string, flags: Flags): CompileResult | null {
  if (source === '') return null;
  const body = flags.wholeWord ? `\\b(?:${source})\\b` : source;
  const flagString = 'g' + (flags.caseInsensitive ? 'i' : '') + (flags.multiline ? 'm' : '');
  try {
    return { ok: true, regex: new RegExp(body, flagString) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // V8: "Invalid regular expression: /(/g: Unterminated group" -> "Unterminated group"
    return { ok: false, error: message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '') };
  }
}

export interface MatchResult {
  /** Half-open [start, end) offsets into the searched text, in order. Empty matches are skipped. */
  ranges: Array<[number, number]>;
  /** True when more matches existed beyond `limit`. */
  truncated: boolean;
}

export function findMatches(text: string, regex: RegExp, limit: number = MATCH_LIMIT): MatchResult {
  const ranges: Array<[number, number]> = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      // Patterns like `a*` or `^` match the empty string everywhere; there is nothing to highlight.
      regex.lastIndex++;
      continue;
    }
    if (ranges.length >= limit) return { ranges, truncated: true };
    ranges.push([match.index, match.index + match[0].length]);
  }
  return { ranges, truncated: false };
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * What to pre-fill the input with when the bar opens: the page selection (escaped) if there is a short
 * single-line one that isn't just the previous search's own match, otherwise the previous pattern.
 */
export function pickPrefill(selection: string, lastPattern: string | undefined, flags: Flags): string {
  const sel = selection.trim();
  if (sel && sel.length <= 200 && !sel.includes('\n')) {
    const last = lastPattern ? compilePattern(lastPattern, flags) : null;
    const first = last?.ok ? findMatches(sel, last.regex, 1).ranges[0] : undefined;
    const isLastMatch = first !== undefined && first[0] === 0 && first[1] === sel.length;
    if (!isLastMatch) return escapeRegExp(sel);
  }
  return lastPattern ?? '';
}
