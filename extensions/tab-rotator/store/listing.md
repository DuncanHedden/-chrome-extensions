# Tab Rotator — Chrome Web Store listing

## Name (manifest `extName`, ≤ 45 chars, must contain "tab rotator" or "rotate tabs")

**Chosen: A** (26 Oct 2026). The others are kept for reference.

| | Title | Chars | Notes |
|---|---|---|---|
| **A** | Tab Rotator – Self-Healing Dashboard Display | 44 | Your lean. Strongest positioning ("self-healing"), and "Tab Rotator" leads. |
| B | Tab Rotator: Rotate Tabs on TVs & Dashboards | 44 | Hits both search phrases ("tab rotator", "rotate tabs") plus "TV" and "dashboard". Best pure SEO. |
| C | Tab Rotator – Rotate Tabs on Unattended TVs | 43 | Both phrases, and says who it's for; "unattended" is less searched. |

## Summary (manifest `extDescription`, ≤ 132 chars)

**Recommended (132):**

> Automatically rotate tabs on TVs and dashboards. Self-healing, schedules, alerts and fleet config. Private: no account, no tracking.

The originally proposed "…fleet config — a Revolver Tabs alternative." (121 chars) names another extension in the summary. The Chrome Web Store spam and impersonation policy is enforced most strictly on the name and summary, and naming a competitor there can get the listing rejected or demoted. The long description mentions Revolver once, factually, which is the lower-risk way to show up for that search.

## Category

Productivity → Tools

## Description

Tab Rotator turns any TV or monitor into a dashboard screen that runs itself. It rotates through your Grafana, Datadog, Power BI, Salesforce, Jira or any other web dashboards, and keeps them working for weeks with nobody touching it: crashed tabs, failed loads, expired logins and frozen pages are fixed automatically.

FREE
• Rotate the tabs in a window, or a playlist of URLs that Tab Rotator opens and keeps open, with a duration per dashboard and an optional fresh reload just before each one is shown.
• Self-healing: crashed tabs and pages that fail to load are skipped and reloaded with backoff, closed playlist tabs reopen, and rotation picks up correctly after sleep, Chrome restarts and clock changes.
• Made for unattended screens: starts when the browser starts, pauses while someone uses the keyboard or mouse, and resumes when they walk away.

PRO, FOR IT TEAMS (per screen: $4/month, $36/year, or $69 lifetime)
• Bad-state detection: signed-out and SSO pages, "502" or "session expired" titles, and pages frozen for N minutes are reloaded, reopened, skipped or alerted on.
• Alerts to Slack, Microsoft Teams, Discord or any webhook when a screen can't fix itself and when it recovers, plus an optional daily "all OK" heartbeat.
• Fleet config: manage every screen from one JSON file in git, S3 or an internal server. Invalid files are rejected and the last good config stays.
• Display hours (e.g. 07:00–18:00 Mon–Fri) with a black screen, a welcome page or another playlist outside them.
• Health log of every anomaly and recovery, exportable as CSV.
• PIN lock for settings and start/stop, so passers-by can't break it.

Privacy: runs entirely in your browser, no data collected. No analytics, no telemetry, no account. Tab Rotator only contacts addresses you give it (your config file and your webhook) and, for Pro, the license server that checks your key.

Keyboard shortcut: Alt+Shift+R (⌥⇧R on Mac) starts and stops rotation. Change it at chrome://extensions/shortcuts. You can also click the toolbar icon.

SET UP A TV IN 2 MINUTES
1. Plug a mini-PC or laptop into the TV, open Chrome, and install Tab Rotator.
2. Right-click the Tab Rotator icon → Options. Choose "A playlist of URLs" and add your dashboards.
3. Tick "Start rotating when the browser starts", then click Start.
4. Optional: launch Chrome with --kiosk for a full-screen display. Full guide for Windows, macOS, Linux and ChromeOS, including auto-login, no-sleep settings and Chrome policies: https://github.com/DuncanHedden/-chrome-extensions/blob/main/docs/kiosk-setup.md

Looking for a replacement for the retired Revolver – Tabs extension? Tab Rotator keeps the simple rotation you know, and adds recovery and fleet management for screens nobody watches.

Support: dmhedden123@gmail.com · https://duncanhedden.github.io/tab-rotator.html

CHANGELOG
1.0.0: First public release. Rotation engine with self-healing (free); detectors, alerts, schedules, health log, settings lock and fleet config (Pro).

## Screenshots (1280×800)

Real captures of the extension, taken from demo pages in `demo/`. Regenerate with `npx tsx extensions/tab-rotator/store/capture.ts`.

1. `1-rotate-dashboards.png`: "Rotate dashboards on any TV, hands-free"
2. `2-health-log.png`: "Every problem and recovery, logged" (health log with CSV export)
3. `3-fleet-config.png`: "Manage every screen from one file" (sample `screens.json`)
4. `4-detectors-alerts.png`: "Signed out? Frozen? Fixed, and you're told"
5. `5-display-hours-lock.png`: "Display hours and a PIN lock"

Small promo tile (440×280): `promo-small-440x280.png` (from `npm run assets`).
