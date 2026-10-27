# Chrome Web Store submission checklist

## One-time setup

- [ ] Register at <https://chrome.google.com/webstore/devconsole> and pay the **US$5 one-time** developer fee. Use a Google account you'll keep long-term; items can't be moved between accounts easily.
- [ ] Enable 2-Step Verification on that account (required to publish).
- [ ] Verify the developer contact email under **Account**.
- [ ] Declare **trader / non-trader** status (EU Digital Services Act). A free, donation-only extension can usually be non-trader. **Selling Tab Rotator Pro makes you a trader**: your address and phone number are then shown publicly on your listings. Consider a business address or virtual office (and a business phone number) before submitting Tab Rotator.
- [ ] Turn on GitHub Pages for this repo (Settings → Pages → deploy from `main`, root). The privacy policy is then at
      `https://<user>.github.io/<repo>/extensions/regex-find/store/privacy`. Open the URL to check it renders.

## Per release

1. [ ] Bump `version` in `extensions/<name>/manifest.json`; add a line to the changelog in `store/listing.md`.
2. [ ] `npm run lint && npm run typecheck && npm test && npm run e2e`
3. [ ] Build the zip: `npm run zip -- <name>` → `release/<name>-<version>.zip`.
       Or tag `git tag <name>-v<version> && git push --tags`; CI attaches the zip to a GitHub release.
4. [ ] Load `extensions/<name>/dist` unpacked one last time and click through the manual test list.
5. [ ] Dashboard → **New item** (first time) or the item → **Package → Upload new package**.

## Store listing tab

- [ ] Description: copy from `store/listing.md`. Name and summary come from the manifest/locales.
- [ ] Category: Regex Find → **Productivity → Tools**.
- [ ] Language: English.
- [ ] Store icon: 128×128 (`public/icons/icon-128.png`).
- [ ] Screenshots: upload all 5 from `store/screenshots/` (1280×800). Recapture after UI changes with `npx tsx extensions/<name>/store/capture.ts`.
- [ ] Small promo tile 440×280: `store/promo-small-440x280.png`.
- [ ] Homepage URL (GitHub repo) and support URL (GitHub issues).

## Privacy practices tab

- [ ] **Single purpose** statement: from `docs/permissions.md`.
- [ ] A **justification for each permission**: from `docs/permissions.md`. Requesting a permission the code doesn't use is a common rejection reason.
- [ ] **Remote code:** "No, I am not using remote code."
- [ ] **Data usage:** tick the data types collected (none for Regex Find) and certify the three disclosures.
- [ ] **Privacy policy URL:** the GitHub Pages URL above.

## Distribution tab

- [ ] Visibility: Public (or Unlisted for a soft launch: installable by link, not searchable).
- [ ] Regions: all.

## Submit and wait

- Review usually takes **1–3 days**. It can take longer for a new developer account, an extension that requests host permissions or broad optional permissions (Tab Rotator), or the first submission after a permission change.
- You get an email either way. You can choose to publish automatically on approval, or approve first and publish manually.

## If it's rejected

1. The email cites a policy and a **violation reference ID** (a colour + element name, e.g. "Purple Potassium"). Look the ID up on Chrome's *Troubleshooting Chrome Web Store violations* page; each has a specific fix. Common ones for us: Purple Potassium (excessive or unused permissions), Yellow Zinc (missing or poor listing metadata), Blue Argon (remote code under MV3), Red Titanium (obfuscated code; our bundles are unminified to avoid this), Purple Lithium (privacy policy / data disclosure).
2. If the reviewer is right: fix it, bump the version, upload, and resubmit. Mention the fix in the "notes to reviewer" field if one is shown.
3. If you think it's a mistake: appeal through the link in the email (One Stop Support). Keep it short and factual: quote the policy, say which file and line shows compliance, and reference `docs/permissions.md`. Appeals take days to weeks, so a quick compliant resubmit is often faster.
4. Repeated or severe violations can get the developer account suspended. Don't resubmit unchanged.

---

# Tab Rotator: submission specifics

Everything above applies; this section has the Tab Rotator answers. Full permission justifications are in [permissions.md](permissions.md).

## Before you upload

- [ ] **Trader declaration done** (see above). Tab Rotator Pro is paid, so you are a trader.
- [ ] Pick the name (see `extensions/tab-rotator/store/listing.md`, options A–C; the manifest currently uses A) and set `"version": "1.0.0"` in `extensions/tab-rotator/manifest.json`.
- [ ] `npm run zip -- tab-rotator` → `release/tab-rotator-1.0.0.zip`. Check its `manifest.json` has **no** `http://localhost/*` (that's only in the e2e test build).
- [ ] Payments work end to end (a 100%-off test purchase, activate, deactivate). See [payments-setup.md](payments-setup.md).

## Store listing tab

- [ ] Description: from `extensions/tab-rotator/store/listing.md`. It states the Pro prices: paid features must be disclosed in the listing.
- [ ] Category: **Productivity → Tools**.
- [ ] Screenshots: the 5 in `extensions/tab-rotator/store/screenshots/` (rotation, health log, fleet config, detectors and alerts, display hours and lock).
- [ ] Small promo tile: `extensions/tab-rotator/store/promo-small-440x280.png`.
- [ ] Homepage URL: `https://duncanhedden.github.io/tab-rotator.html`. Support URL: `https://github.com/DuncanHedden/-chrome-extensions/issues`.

## Privacy practices tab

**Single purpose:**
> Automatically rotate between browser tabs on an unattended display, and keep that display working by recovering tabs that crash, fail to load or are closed.

**Permission justifications** (paste one per box):

| Permission | Paste this |
|---|---|
| `tabs` | Reads the URL, loading status and crash state of tabs in the window being rotated, to switch between them, skip tabs that are loading or crashed, and match playlist URLs to open tabs. Tab data never leaves the device. |
| `storage` | Saves the playlist, per-tab settings, rotation state (so rotation survives the service worker restarting) and a local log of rotation events. |
| `alarms` | Wakes the extension to switch tabs on intervals of 30 seconds or more, and runs a 30-second watchdog while rotation is on. |
| `offscreen` | Runs a timer in a web worker inside an offscreen document, to switch tabs on intervals shorter than the 30-second minimum of chrome.alarms. Created only while rotation runs, and closed when it stops. |
| `idle` | Pauses rotation while someone is using the keyboard or mouse, and resumes after a configurable idle time. |
| `webNavigation` | Detects when a rotated page fails to load (DNS or connection errors), so the extension can reload it instead of leaving an error page on an unattended screen. Only main-frame errors are used. |
| Host permission `https://api.polar.sh/*` | Checks the Pro license key with the payment provider's license API, when a key is entered and about twice a day. Required rather than optional because keys can arrive via the user's fleet configuration file on screens where nobody is present to accept a prompt. |
| Optional host permissions (`https://*/*`, `http://*/*`) and optional `scripting` | Requested for one specific origin at a time, from the user's click: their own fleet-config URL, their own alert webhook URL, and, only if they enable page-text comparison, the dashboards being rotated, to hash the visible text to detect a frozen page. Declared broadly only because these addresses are the user's own and unknown in advance. |

**Remote code:** "No, I am not using remote code." The fleet config is JSON data, validated against a schema; nothing fetched is ever executed.

**Data usage:** tick **none** of the data types, and certify the three statements. Rationale: the developer receives no user data, and the only transmissions are user-directed (to the user's own config URL and webhook) or a license-key check with the payment provider, all disclosed in the privacy policy. If a reviewer disagrees, the closest category for the license check is "Authentication information"; declaring it is harmless, but don't over-declare up front.

**Privacy policy URL:** `https://duncanhedden.github.io/-chrome-extensions/extensions/tab-rotator/store/privacy`. Open it to check it renders. (Or link the site-wide `https://duncanhedden.github.io/privacy.html`, which links to it.)

## Test instructions tab (helps the reviewer)

```
No account needed for the free features. Open 3 tabs in a window (any sites), click the Tab Rotator toolbar icon: the badge shows ON and tabs switch every 30 seconds (Options → "Show each tab for" to shorten). Right-click the icon → Options for all settings. Pro features are greyed out without a license key; a test key is available on request at dmhedden123@gmail.com.
```

Give the reviewer a real Pro key (from a 100%-off order in Polar) in the instructions if you want them to see the Pro features. It speeds up review of the optional permissions.

## Likely review questions

- **"Why `offscreen`?"** Answer with the justification above: offscreen documents must state a reason, and ours is `WORKERS`. The timer genuinely runs in a dedicated Worker, because timers in hidden documents are throttled to once a minute. See `src/engine/timer.ts`.
- **"Why broad optional host permissions?"** Each origin is requested individually at runtime from a user gesture; see `src/options/alerts-ui.ts` and `src/options/fleet-ui.ts`. Nothing is requested at install.
- **Review time:** expect it to take longer than Regex Find (sometimes a week or more) because of `tabs`, `webNavigation` and the broad optional host permissions.
