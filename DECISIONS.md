# Decisions

Dated one-liners for non-obvious choices. Newest at the bottom of each section.

## Monorepo / tooling

- 2026-10-26 — npm workspaces, not pnpm: pnpm wasn't installed, and npm workspaces cover a handful of private packages fine.
- 2026-10-26 — TypeScript pinned to 6.0.x: typescript-eslint supports `<6.1`, so TS 7 would break linting.
- 2026-10-26 — Plain esbuild, not Vite + @crxjs: crxjs serves dynamically injected content scripts through a loader that pulls chunks from `web_accessible_resources` (exposed to every site, and fingerprintable). We need three IIFE bundles and a static copy. The cost is no HMR: `npm run dev` rebuilds, then you reload in chrome://extensions.
- 2026-10-26 — Bundles are not minified: reviewers read the code, and minified bundles invite "obfuscation" questions. Size is irrelevant at ~35 KB.
- 2026-10-26 — `packages/shared` exports TypeScript source directly (no build step); esbuild and vitest compile it in place.
- 2026-10-26 — Version source of truth is each `manifest.json`; release tags are `<extension>-v<version>`, and `scripts/zip.ts --expect-version` fails CI on a mismatch.
- 2026-10-26 — The zip uses a fixed mtime, so the same source gives a byte-identical artifact.
- 2026-10-26 — Icons and placeholder screenshots are rendered from SVG/HTML with the Playwright Chromium we already depend on; no image tooling to install.

## Regex Find

- 2026-10-26 — `activeTab` + `scripting` with on-demand injection, no persistent content script: there's no "read and change all your data" install warning, at the cost of ~10–50 ms injection on first open per page.
- 2026-10-26 — Mac default shortcut is ⌃⇧F (`MacCtrl+Shift+F`), not ⌘⇧F: Chrome silently refuses ⌘⇧F (it's already a Chrome shortcut), which would leave Mac users with no shortcut at all (verified in Chromium 156). ⌃⇧F uses the same physical keys as Ctrl+Shift+F elsewhere.
- 2026-10-26 — Toolbar click opens the find bar directly; no popup. A popup would just be one more click before the real UI. Options are reached via right-click → Options.
- 2026-10-26 — Same-origin iframes are searched from the top frame via `contentDocument` rather than `allFrames` injection. `activeTab` only grants the top-level origin anyway, and this gives one script and one ordered match list. Cross-origin frames return null and are skipped.
- 2026-10-26 — CSS Custom Highlight API, with a `<mark>`-wrapping fallback only when `CSS.highlights` is missing (Chrome 100–104; `minimum_chrome_version` is 100). The fallback restores the DOM exactly on clear but can still disturb framework-managed text nodes, so it is never used when the API exists.
- 2026-10-26 — All styles go in via `adoptedStyleSheets` and CSSOM writes, never `<style>` tags or style attributes, so pages with a strict `style-src` CSP still work. The e2e fixture serves `style-src 'self'` to prove it.
- 2026-10-26 — Find bar in a closed shadow root attached to `<html>` (not `<body>`), with key events stopped at the host, so page CSS, scripts and keyboard shortcuts can't interfere.
- 2026-10-26 — Text is matched as rendered: whitespace collapses as in CSS (except `pre`/`pre-wrap`), block boundaries become a virtual `\n`, and with the multiline flag `^`/`$` anchor at block edges. Hidden text (`display:none`, `visibility:hidden`) is skipped, matching the native find bar.
- 2026-10-26 — Shadow DOM is walked in flat-tree order (slots → assigned nodes). Closed shadow roots are read via `chrome.dom.openOrClosedShadowRoot`, but only for custom elements, to keep the per-element cost down.
- 2026-10-26 — The text index is built in 2,000-node chunks that yield to the page, cached, and invalidated by a MutationObserver (500 ms debounce) that re-runs the search. Highlights are capped at 5,000. Measured: a 40k-row table indexes in ~1.4 s and re-searches in ~130 ms.
- 2026-10-26 — Known limitation: the regex runs on the page's main thread, so a catastrophically backtracking pattern can hang the tab. A worker would need the page text copied out of the content script, which isn't worth it for v1.
- 2026-10-26 — Known limitation: values inside `<input>`/`<textarea>` aren't searched (Ranges can't target them).
- 2026-10-26 — Flag toggles in the bar last for that session only; defaults are set on the options page. Settings go in `storage.sync`; pattern history in `storage.local` (patterns may be sensitive).
- 2026-10-26 — Closing the bar leaves the current match selected (like native find), and the next open pre-fills the last pattern rather than that selection.
- 2026-10-26 — e2e: Playwright can't fire browser-level shortcuts, and `activeTab` needs a real gesture, so tests use a separate `dist-e2e` build that adds `http://localhost/*` and call the real handler exposed on the service worker's global. Store zips never include that permission.
- 2026-10-26 — Store name "Regex Find – Regular Expression Page Search" (43 chars) instead of the proposed 49-char title, to meet the 45-char target while keeping "regex" and "regular expression". The listing doesn't name the dead extension: that risks keyword-spam / impersonation flags.
- 2026-10-26 — The ExtensionPay license client is deferred to the Multi Forward phase; Regex Find has no paywall, so nothing exercises it yet.
