# Regex Find — Chrome Web Store listing

## Name (manifest `extName`, 43 / 45 chars)

Regex Find – Regular Expression Page Search

> The originally proposed "Regex Find – Search Page with Regular Expressions" is 49 chars: allowed by the
> store (limit 75) but over our 45-char target. Swap it in `public/_locales/en/messages.json` if you prefer it.

## Summary (manifest `extDescription`, 120 / 132 chars)

Regex search for any web page: find text with regular expressions, highlight every match, jump between them. 100% local.

## Category

Productivity → Tools

## Description

Regex Find is Ctrl-F with regular expressions. Press Ctrl+Shift+F (⌃⇧F on Mac) on any page, type a pattern, and every match lights up.

• Search with real JavaScript regular expressions: \d{4}-\d{2}-\d{2}, (error|warn).*timeout, ^Total — with toggles for match case, whole word and multiline.
• Highlights every match without changing the page. Regex Find uses the browser's CSS Custom Highlight API, so it never rewrites the page's HTML and can't break web apps, forms or editors. Press Enter / Shift+Enter to jump between matches.
• Works where you need it: fast on huge pages (up to 5,000 highlighted matches), inside same-origin iframes and web components, and on pages with strict security policies.

Privacy: runs entirely in your browser, no data collected. No analytics, no tracking, no network requests, no account. Your settings sync through your own Chrome profile; your pattern history stays on this device and can be turned off.

Keyboard shortcut
• Open: Ctrl+Shift+F (Windows, Linux, ChromeOS) / ⌃⇧F (Mac). Change it at chrome://extensions/shortcuts.
• Next / previous match: Enter / Shift+Enter
• Toggle match case / whole word / multiline: Alt+C / Alt+W / Alt+M
• Previous patterns: ↑ / ↓
• Close: Esc (the current match stays selected, ready to copy)

You can also click the toolbar icon. Regex Find only runs on a tab when you open it there, so it needs no permission to read your sites.

Options: default flags, highlight colours, and pattern history (last 20, local only).

Regex Find is free. If it saves you time, there's a "buy me a coffee" link on the options page.

Changelog
1.0.0 — First release.

## Screenshots (1280×800)

Placeholders in `screenshots/` (regenerate with `npm run assets`). Replace each with a real capture:

1. **Search any page with regular expressions** — bar open on a docs or log page, pattern like `\b[A-Z]{2,}-\d+\b`, matches highlighted.
2. **Every match highlighted, without breaking the page** — busy page (e.g. a GitHub issue list) with dozens of highlights.
3. **Match case, whole word and multiline toggles** — close-up of the bar with a toggle pressed and the tooltip visible.
4. **Invalid pattern? You get an error, not a crash** — bar showing "Unterminated group" in red.
5. **Private: runs entirely in your browser** — the options page (no-tracking line, history toggle).

Small promo tile (440×280): `promo-small-440x280.png`.
