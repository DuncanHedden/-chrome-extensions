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

## Tab Rotator

- 2026-10-26 — Built in the existing monorepo rather than a fresh directory: the requested layout (`extensions/`, `packages/shared`, `scripts/zip.ts`, CI) already exists there.
- 2026-10-26 — esbuild, not crxjs, for the same reasons as Regex Find. The service worker, offscreen page and its worker are just four entry points in `build.config.json`.
- 2026-10-26 — Added the `webNavigation` permission (beyond the requested list): through `tabs`, a failed load looks identical to a working page (status "complete", title = hostname). Only `webNavigation.onErrorOccurred` reports it (verified). It adds no install warning, since `tabs` already shows the same "Read your browsing history".
- 2026-10-26 — Crash detection polls `tab.status === "unloaded" && !tab.discarded` on every reconcile: Chrome fires no event when a renderer dies (verified). Detection latency is bounded by the next wake, at most 30 s (the watchdog).
- 2026-10-26 — `reconcile()` is a pure function of (stored state, settings, world snapshot, now) → (new state, actions, log entries, next wake). All Chrome calls live in `runtime.ts`, which runs entry points through one serial queue, so concurrent events can't interleave read-modify-write.
- 2026-10-26 — Sub-30 s waits use a dedicated Worker inside the offscreen document, with reason `WORKERS`. Timers in hidden documents are throttled to once a minute after 5 minutes, but workers are exempt, and it keeps the stated offscreen reason honest. The risk is that a reviewer questions offscreen-as-timer; the justification text is in docs/permissions.md.
- 2026-10-26 — A 30 s watchdog alarm runs while rotating, regardless of other timers, so a lost timer or a missed event costs at most 30 s.
- 2026-10-26 — Settings and state live in `storage.local`, not `sync`. Screens often share one Google account, and sync would push one screen's playlist to every TV.
- 2026-10-26 — Waking late (sleep, suspended Chrome, clock jump forward) advances exactly one item and restarts its timer, with a log entry if more than 60 s late. Catching up through missed slots is meaningless on a wall display.
- 2026-10-26 — If the next switch is further away than the current item's whole duration, the clock went backwards, so the timer restarts instead of the screen freezing.
- 2026-10-26 — Rotation time is epoch-based, so DST changes don't affect it. Wall-clock DST handling belongs to the schedule engine (milestone 2).
- 2026-10-26 — Reload-before-show reloads the upcoming tab min(15 s, half the current slot) before its turn, and shows it even if it's still loading. Skipping it would mean a slow dashboard is never shown.
- 2026-10-26 — Discarded tabs (Memory Saver) are reloaded in the background and shown next time round rather than activated cold. The kiosk guide will say to turn Memory Saver off.
- 2026-10-26 — The tab actually in front is the source of truth: if a person (or Chrome, after closing the current tab) brings another rotation tab forward, rotation continues from it.
- 2026-10-26 — While our own options page is in front, rotation holds, so configuring a screen doesn't rotate the settings away.
- 2026-10-26 — Idle pause is event-driven (`idle.onStateChanged`): clicking Start doesn't immediately pause. Resume restarts the current item's timer. The resume delay has a 15 s minimum (an API limit).
- 2026-10-26 — Auto-start waits 5 s after Chrome starts, so session-restored playlist tabs are adopted (prefix URL match, ignoring #fragment and trailing slash) instead of opened twice. With auto-start off, a Chrome start leaves rotation stopped.
- 2026-10-26 — Playlist mode never closes tabs it didn't open; it closes only tabs it owns whose entry was removed from the playlist.
- 2026-10-26 — Failing tabs reload with backoff of 5 s, 15 s, 1 min, 5 min, then every 15 min. An error is logged at the 5th attempt (milestone 3 alerts hook in there). A tab must stay healthy 3 s after a reload to count as recovered.
- 2026-10-26 — Toolbar click toggles start/stop (no popup); settings are under right-click → Options. Default shortcut Alt+Shift+R (⌥⇧R), verified as actually assigned on Mac.
- 2026-10-26 — The health log (2,000 entries, ring buffer) is written from milestone 1, since the engine already produces the events. The viewer and CSV export come in milestone 2.
- 2026-10-26 — Milestone 2: Pro features are gated in one function, `gateSettings()` in `src/pro.ts`, built on the shared `packages/shared/license.ts`. Free users keep their Pro configuration (it just has no effect), so upgrading restores it. Milestone 3 plugs ExtensionPay in behind `getLicense()`.
- 2026-10-26 — Until payments exist, unpacked builds (no `update_url` in the manifest) show a "Developer: enable Pro" switch. A store install can never honour it.
- 2026-10-26 — The free tier keeps a "last 20 events" view; the full log, filters and CSV export are Pro. Free users can still see that self-healing works.
- 2026-10-26 — Detectors are evaluated inside `reconcile()`. Reload/reopen detectors reuse the crash backoff and recovery path; "unchanged for N min" is a one-off refresh that restarts the clock, with no backoff, since a static page legitimately stays unchanged.
- 2026-10-26 — "Unchanged" compares URL + title + favicon from the `tabs` API by default (no permission). Page-text hashing is opt-in per rule and needs the optional `scripting` permission plus host permission for those sites, requested from the click that enables it. The hash is sampled (≤ 4k chars) and taken at most once a minute per tab.
- 2026-10-26 — Detector "reopen" navigates the existing tab back to its home URL (the playlist URL, or the URL a window tab had when it joined) rather than close + create, so the tab keeps its place and ID.
- 2026-10-26 — Detectors act even with built-in self-healing off: they're explicit rules the user wrote.
- 2026-10-26 — Schedules: one schedule switches between the main rotation and off-hours content (blank page, custom page, or a second playlist), rather than full multi-playlist scheduling. That covers every case in the brief with a much simpler model and UI.
- 2026-10-26 — Schedule evaluation is wall-clock, via Intl with an optional IANA zone (default: the computer's), so DST is handled by the tz database. A window crossing midnight belongs to the day it starts. No next-boundary computation: the 30 s watchdog checks the schedule, so transitions land within 30 s, and a boundary crossed during sleep is applied on wake.
- 2026-10-26 — Off-hours tabs are closed when display hours start. Playlist tabs stay open overnight so they're warm in the morning.
- 2026-10-26 — Settings lock: PBKDF2-SHA256 (100k iterations, random salt) PIN hash; 5 wrong tries locks out for 1 min, doubling each round; wrong PINs go to the health log. It deters passers-by; real lockdown is Chrome policy (kiosk guide). Rotation holds only on an *unlocked* settings page (`#unlocked`), so a PIN prompt left on screen is rotated away.
- 2026-10-26 — With the lock on, the toolbar button and shortcut open the settings page instead of toggling.
- 2026-10-26 — Milestone 3 payments: **Lemon Squeezy license keys instead of ExtensionPay** (decided with Duncan). ExtPay.js is AGPL-3.0, so bundling it would put the extension under AGPL. It also licenses per Chrome profile (a checkout or login per TV). License keys give one key for N screens (activations), can be distributed through the fleet config, and Lemon Squeezy is merchant of record (sales tax/VAT). Our own client, roughly 150 lines in `packages/shared/license.ts`.
- 2026-10-26 — Keys are only honoured for our store ID and product IDs; anyone can mint free keys in their own Lemon Squeezy store. A wrong-product activation is immediately deactivated, to give the slot back.
- 2026-10-26 — Re-validate every 12 h. If the license server is unreachable (network error or 5xx), Pro stays on for 14 days after the last successful validation, so an outage never downgrades an unattended screen. A definite "expired/disabled" answer turns Pro off at once, with an error alert.
- 2026-10-26 — `https://api.lemonsqueezy.com/*` is a *required* host permission: keys can arrive via fleet config on a screen where nobody is present to accept a permission prompt. Its install warning is narrow and explained in docs/permissions.md.
- 2026-10-26 — Fleet config and license bootstrapping: a free screen with a config URL still polls the file, but applies only its `license` section. Once the key activates, the rest applies on the next poll, so one person can license and configure 50 screens by editing one file.
- 2026-10-26 — Our own JSON Schema validator (subset, ~100 lines) instead of Ajv: Ajv compiles schemas with `new Function`, which MV3's CSP forbids. The schema lives in `packages/shared/schemas/`, and its `$id` points at GitHub Pages so editors can validate configs live.
- 2026-10-26 — Config merge: defaults, then the screen section; objects merge, arrays replace. Settings the file omits stay local. The file can never change the screen name or config URL (so a bad edit can't orphan a screen). Applying only happens when the file's SHA-256 changes, so local tweaks survive until the file next changes; the options page shows a banner.
- 2026-10-26 — Config playlist entries get stable IDs from a URL hash plus occurrence index, so reordering or editing the file doesn't make screens close and reopen every tab.
- 2026-10-26 — Invalid config: rejected and logged once per distinct error (an `error`, so it alerts); the last good config stays. Fetch failures are `warn` (no alert): a config server outage shouldn't page anyone, and screens keep working.
- 2026-10-26 — `lock.pin` in the config is hashed on the screen. If the PIN is unchanged, the existing hash is kept, rather than re-salted on every poll.
- 2026-10-26 — Alerts fire on health-log `error` entries (problems the screen couldn't fix: still failing after 5 attempts, detector "alert" action, rejected config, license revoked), and on recovery of a page that had an alerted incident. The same incident is de-duplicated for 30 min, with a global cap of 10/hour; the next alert reports how many were held back.
- 2026-10-26 — Alerts never alert about themselves: delivery failures are logged as warnings. One retry on network error, 5xx or 429.
- 2026-10-26 — Webhook and config URLs need host permission for their exact origin, requested from the user's click on that screen. URLs that arrive through the config file show a one-time "Allow" button on the screen (Chrome only shows permission prompts during a user gesture).
- 2026-10-26 — Teams payloads use an Adaptive Card message, which works with the current Teams "Workflows" webhooks (the older Office 365 connectors are retired).
- 2026-10-26 — The daily heartbeat is a chrome.alarms `when` at the next wall-clock occurrence (DST-safe, using the schedule's time zone), rescheduled after each send. A machine asleep at heartbeat time sends it on wake.
- 2026-10-26 — `scheduleWake()` now clears only the rotation timers: fleet, heartbeat and license alarms run whether or not rotation is on.
- 2026-10-26 — **Switched license keys from Lemon Squeezy to Polar** (decided with Duncan): Lemon Squeezy redirected new sellers to Stripe Managed Payments, which has no license keys (that would need a paid licensing service or a server). Polar is a merchant of record with a public customer-portal License Key API (activate / validate / deactivate, no secret key) and per-key activation limits, so the design above is unchanged. Keys are scoped to our organization server-side, and we also pin the license-key benefit IDs. Per-screen pricing is sold as screen bundles (one benefit per activation limit).
- 2026-10-26 — Polar answers "not valid" with a 404 (revoked, expired, or activation removed): Pro off immediately. Network errors, 5xx and 429: offline grace. A deactivate that returns 404 counts as success (the slot is already free).
