# Chrome extensions

Manifest V3 extensions rebuilt to replace abandoned MV2 ones. No analytics, no remote code; everything runs locally.

| Extension | Status |
|---|---|
| [Regex Find](extensions/regex-find) | 1.0.0, submitted to the Web Store |
| [Tab Rotator](extensions/tab-rotator) | feature-complete (milestones 1–3), Polar payments live; store listing ready, awaiting submission. See [TESTING.md](extensions/tab-rotator/TESTING.md) |

## Layout

```
extensions/<name>/   manifest.json, src/, public/ (static files copied as-is), store/, test/, e2e/
packages/shared/     storage, i18n, DOM helpers shared by all extensions
scripts/             build.ts, zip.ts, render-assets.ts
testing/             Playwright helpers (launch with extension, fixture server)
docs/                permissions.md, store-submission-checklist.md, kiosk-setup.md, remote-config.md,
                     payments-setup.md, competitor-comparison.md
```

## Commands

```sh
npm install
npm run build                  # all extensions -> extensions/*/dist
npm run dev -- regex-find      # rebuild on save; reload the extension in chrome://extensions
npm run zip -- regex-find      # release/regex-find-<version>.zip, ready for the Web Store
npm run lint && npm run typecheck && npm test
npx playwright install chromium && npm run e2e
npm run assets                 # re-render icons + promo tile from assets/icon.svg
npx tsx extensions/regex-find/store/capture.ts   # real store screenshots
```

Load unpacked: chrome://extensions → Developer mode → **Load unpacked** → `extensions/<name>/dist`.

Releases: `git tag regex-find-v1.0.0 && git push --tags`. CI checks the tag matches the manifest version and attaches the zip to a GitHub release.

Choices and trade-offs: [DECISIONS.md](DECISIONS.md).
