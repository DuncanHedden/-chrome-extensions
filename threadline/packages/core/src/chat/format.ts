/** Escape user content for card text, which accepts a small HTML subset (<b>, <i>, <a>, <br>, <font>). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Neutralise Chat text-message markup in user content. `<users/all>` in an issue summary would otherwise
 * @-mention the whole space, and `<url|label>` could disguise links. A zero-width space after `<` keeps the
 * text readable while breaking the syntax; `*`, `_`, `~` and backticks are left alone (cosmetic only).
 */
export function escapeChatText(s: string): string {
  return s.replace(/</g, '<​');
}

/** Truncate on a code-point boundary, collapsing whitespace, with an ellipsis. */
export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

/** Like truncate, but keeps line breaks (up to `maxLines`) for comment excerpts. */
export function excerpt(s: string, maxChars: number, maxLines = 6): string {
  const lines = s.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l, i, a) => l || (i > 0 && a[i - 1]));
  let out = lines.slice(0, maxLines).join('\n').trim();
  const clipped = lines.length > maxLines;
  const chars = Array.from(out);
  if (chars.length > maxChars) out = chars.slice(0, maxChars - 1).join('').trimEnd() + '…';
  else if (clipped) out += '\n…';
  return out;
}
