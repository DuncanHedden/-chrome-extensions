# Tab Rotator vs Tab Revolver vs goRotate

An honest comparison, built only from what each product's public pages say. Where a page doesn't mention a feature, the table says "not mentioned" rather than "no": they may have it without advertising it.

_Checked 26 October 2026. Sources are listed at the bottom; re-check before quoting this anywhere public._

## Who's who

- **Tab Rotator** (Hedden Software): this repo. Built for IT and ops teams running many unattended screens.
- **Tab Revolver** (Variabl, tabrevolver.variabl.co): a playlist-based tab rotator for Chrome and Edge, with remote screen pairing. Its site claims 5,000+ users. Its listing appears on the Chrome Web Store as "Revolver Tabs".
- **goRotate** (Ben Hedrington): the rewrite of the original **Revolver – Tabs** (~200k users), by its original author, after Manifest V2 was retired. It rotates the window's open tabs. 10,000 users, 3.2★ from 22 ratings on the Chrome Web Store; version 1.1.0 (18 Nov 2025).

## At a glance

| | **Tab Rotator** | **Tab Revolver** | **goRotate** |
|---|---|---|---|
| **Price** | Free; Pro $4/screen/month, $36/screen/year, $69/screen lifetime | Free; Pro $2/month or $19.99 lifetime, each covering 3 screens | Free (no paid tier mentioned) |
| **Account needed** | No | Only for Pro, sync and Screens | No |
| **Data leaves the device** | Only to addresses you configure (your config file, your webhook) and the license check | Playlist URLs are stored with their service when signed in | "Will not collect or use your data" |
| **Browsers** | Chrome, Edge, other Chromium | Chrome, Edge | Chrome |

## Rotation basics

| | Tab Rotator | Tab Revolver | goRotate |
|---|---|---|---|
| Rotate a window's open tabs | ✓ Free | ✓ | ✓ |
| URL playlists | ✓ Free (1 main + 1 off-hours with Pro) | ✓ (Free: 1; Pro: unlimited) | Not mentioned |
| Per-tab durations | ✓ Free | ✓ | Not mentioned (one interval) |
| Reload before showing | ✓ Free (reloads *ahead* of its turn, so it appears already loaded) | ✓ ("reload each tab upon display") | ✓ (optional reload on each view) |
| Start on browser launch | ✓ Free | ✓ (listed in their plan comparison) | ✓ (added in v1.1.0) |
| Pause for people | ✓ Free: pauses on any keyboard/mouse use, resumes after N s idle | ✓ Pause on hover and hotkeys | Not mentioned |
| Exclude pinned tabs / personal windows | ✗ (rotates the whole chosen window; use playlist mode instead) | ✓ | Not mentioned |
| Auto-scroll long pages | ✗ | ✓ Pro | Not mentioned |
| Remote control from a web dashboard / PIN pairing | ✗ (managed via a config file instead, see below) | ✓ 6-digit PIN pairing, cast playlists remotely | Not mentioned |

## Keeping a screen correct, unattended (where Tab Rotator is different)

| | Tab Rotator | Tab Revolver | goRotate |
|---|---|---|---|
| Survives service-worker restarts, sleep, clock changes and Chrome restarts (state reconciled on every wake) | ✓ Free | Not mentioned | Not mentioned |
| Skip tabs still loading | ✓ Free | Not mentioned | Not mentioned |
| Detect crashed tabs and reload them with backoff | ✓ Free | Not mentioned | Not mentioned |
| Detect failed page loads (DNS, connection errors) and retry | ✓ Free | Not mentioned | Not mentioned |
| Reopen playlist tabs that were closed | ✓ Free | Not mentioned | Not mentioned |
| **Bad-state detectors**: signed-out/SSO pages, "502"/"session expired" titles, frozen pages → reload, reopen, skip or alert | ✓ Pro | Not mentioned | Not mentioned |
| **Health log** with CSV export | ✓ Pro (Free: last 20 events) | Not mentioned | Not mentioned |
| **Alerts** to Slack / Teams / Discord / webhook, plus a daily heartbeat | ✓ Pro | Not mentioned | Not mentioned |
| **Display-hours schedules** with off-hours content (black screen, page or playlist), DST-safe | ✓ Pro | Not mentioned | Not mentioned |
| **Settings lock** (PIN) | ✓ Pro | Not mentioned | Not mentioned |
| **Fleet config as code**: every screen from one validated JSON file in git; bad files rejected, last good one kept | ✓ Pro | Not mentioned (remote dashboard instead) | Not mentioned |

## Where each one fits

- **One person, one TV, wants it simple and cheap:** Tab Revolver's Free or $2 plan, or goRotate (free) if rotating the open tabs is enough. Tab Rotator's free tier also covers this, and adds recovery from crashes and failed loads.
- **Someone wants to change what's on a TV from their phone or laptop:** Tab Revolver's PIN pairing and web dashboard are built for that. Tab Rotator doesn't offer it; changes go through the config file or the screen's settings.
- **IT or ops managing 5–50 screens they never touch:** Tab Rotator Pro. It's the only one of the three that, on its public pages, detects and fixes bad states, keeps a health log, alerts a channel, follows display hours, locks its settings, and takes its configuration from a file you can review and roll back in git.

## Sources

- Tab Revolver home page: <https://tabrevolver.variabl.co/>
- Tab Revolver pricing: <https://tabrevolver.variabl.co/pricing>
- goRotate on the Chrome Web Store: <https://chromewebstore.google.com/detail/jhkfmnapfhbolleochedngmapebghedi>
- Revolver – Tabs (original) on the Chrome Web Store: <https://chromewebstore.google.com/detail/dlknooajieciikpedpldejhhijacnbda>
- "Revolver Tabs" (Tab Revolver's listing) on the Chrome Web Store: <https://chromewebstore.google.com/detail/revolver-tabs/dfaikhlghfmpehefjcnbokmhhngdnjdf>
