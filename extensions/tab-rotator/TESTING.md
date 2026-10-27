# Tab Rotator: manual test plan and soak checklist (milestone 1)

## Setup

```sh
cd ~/chrome-extensions && git pull && npm install && npm run build -- tab-rotator
```

In `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `extensions/tab-rotator/dist`. Pin the icon (puzzle piece → pin) so you can see the badge.

- **Badge:** `ON` (green) means rotating, `II` (amber) means paused for a human, blank means stopped.
- **Settings:** right-click the icon → **Options**. The "Recent events" list at the bottom is the health log.
- **Inspecting state:** chrome://extensions → Tab Rotator → **service worker** opens DevTools, where `await chrome.storage.local.get(null)` shows the stored state.
  **Close that DevTools window before any lifetime or soak test.** While DevTools is attached, Chrome never shuts the service worker down, which hides exactly the bugs these tests look for.

After each rebuild, click the reload icon on the Tab Rotator card in chrome://extensions.

## Manual test plan (≈30 min)

| # | Do | Expect |
|---|---|---|
| 1 | Open 3–4 tabs (any sites). Options: "The tabs in this window", 5 s. Click the toolbar icon. | Badge `ON`. Rotates left→right every 5 s, wraps around. Starts from the tab you were on. |
| 2 | Click the icon again; press ⌥⇧R / Alt+Shift+R twice. | Stops/starts each time. Check the shortcut in Options matches. |
| 3 | Add a per-tab rule: URL prefix of one tab, 15 s. | That tab stays 15 s, the others 5 s. |
| 4 | While rotating, open Options in the same window. | Rotation holds while Options is in front and resumes when you switch away. |
| 5 | While rotating, click a different tab by hand. | Rotation continues from the tab you picked. |
| 6 | Close the tab currently on screen. | Carries on from its neighbour. "The tab on screen was closed" appears in Recent events. |
| 7 | Playlist mode: add 3 URLs (one with 40 s, to exercise the >30 s alarm path), start. | Tabs open in the background, then rotate in playlist order. Existing tabs are left alone. |
| 8 | Playlist: close one of its tabs. | Reopened within a second or two. "reopened" logged. |
| 9 | Playlist: edit while running (add, remove, reorder, change a duration). | Add opens a tab; remove closes only that entry's tab; current item kept; new order and durations apply from the next switch. |
| 10 | Tick "Reload before showing" on one entry (60 s default). | It reloads in the background ~15 s before its turn, then appears freshly loaded. |
| 11 | Turn on "Pause while someone uses…" with 15 s. Move the mouse while rotating. | Badge `II` within ~1 s, "Paused" logged. Hands off for 15 s: badge `ON`, "Resumed" logged. |
| 12 | Kill a rotating tab's process: Chrome menu → More tools → Task manager, select the tab → End process. | Within 30 s: "Tab crashed", "Reloading (attempt 1)", then "Recovered". It's skipped while broken. |
| 13 | Add a playlist URL that can't load, e.g. `https://does-not-exist.invalid/`. | "Page failed to load (net::ERR_NAME_NOT_RESOLVED)". Retries at 5 s, 15 s, 1 min, 5 min, then every 15 min ("Still failing" logged at attempt 5). Never shown on screen. |
| 14 | Settings → "Start rotating when the browser starts", quit Chrome fully (⌘Q), relaunch. | About 5 s after launch the badge shows `ON` and rotation resumes. In playlist mode with session restore on, no duplicate tabs. |

## Overnight soak checklist

Run each on real hardware with service-worker DevTools **closed**. Afterwards, check Recent events and the bullets.

- [ ] **Sleep/wake.** Rotate a playlist (one entry under 30 s, one over), put the machine to sleep for 1+ hour, wake it.
  - One switch within a second or two of waking, then normal cadence. "Woke … late" logged with roughly the right gap. No burst of rapid switches.
- [ ] **Network drop.** Rotate 3 real dashboards. Turn Wi-Fi off for 10 min, then back on.
  - Reloads that happen while offline log load errors and back off (not a reload storm).
  - After the network returns, every tab is "Recovered" within the backoff window (≤ 5 min if it had reached that step).
  - The screen never sits on a Chrome error page longer than one slot.
- [ ] **Crash a tab.** Task manager → End process on a tab (as in test 12). Repeat on the tab that's on screen.
  - Recovered both times; the on-screen case switches away immediately.
  - Alternative: typing `chrome://crash` in a tab's address bar also works, but that URL crashes again every time it's reloaded. Expect the full backoff and a "Still failing" entry, which tests the backoff rather than recovery.
- [ ] **Close a tab mid-rotation**, in both window and playlist modes (tests 6 and 8), several times in a row, quickly.
- [ ] **Chrome restart.** With auto-start on: quit and relaunch; then also kill Chrome hard (Activity Monitor → Force Quit), relaunch, and choose "Restore" if offered.
  - Rotation resumes on its own, with no duplicate playlist tabs.
- [ ] **Clock change.** Change the system time back 1 hour while rotating, then forward 2 hours.
  - Back: "clock moved backwards", rotation continues at normal cadence (no 1-hour freeze). Forward: one "late" entry, then normal cadence.
- [ ] **12-hour run on a spare monitor.** A 4–6 entry playlist of the real dashboards you'd deploy (Grafana/Datadog/etc.), a mix of 10 s and 60 s durations, one with reload-before-show. Turn off OS sleep and Chrome Memory Saver (Settings → Performance) first.
  - Next morning: badge `ON`, still on cadence (time a few switches with a stopwatch).
  - Recent events: count and skim the warnings. Note anything that isn't explained by something you did or a real outage.
  - Chrome Task manager: note each dashboard tab's memory at the start and end. Growth there is the dashboard's leak, not ours, but it's what will eventually kill a screen. Tell me and we'll make "reload every N hours" a feature.

Send me anything surprising: what you did, what you saw, and a copy of the Recent events list (or `chrome.storage.local.get('healthLog')` from the service-worker console).

## Milestone 2: Pro features (≈30 min)

Rebuild (`npm run build -- tab-rotator`), reload the extension, and open Options. At the bottom, tick **Developer build: enable Pro features for testing**. The badge in the top right of the page should say **Pro (developer)**. Untick it at any point to check that the Pro sections grey out and stop having any effect.

| # | Do | Expect |
|---|---|---|
| 1 | **Detectors:** playlist mode, add `https://httpbin.org/status/502` as an entry, then "Add a ready-made rule → Error or expired-session title". | That tab is never shown; Health log shows "Bad state … detected; reloading" then reload attempts backing off. Remove the rule: next pass it's shown. |
| 2 | Add a rule "the URL matches `/login`", action "reopen the original URL". Add a playlist entry for a site that redirects to a login page when signed out (e.g. a private GitHub repo in a signed-out profile). | It's skipped, sent back to the original URL with backoff, and logged. |
| 3 | Add "Frozen" with 1 minute on a static page such as `https://example.com`. | About every minute: "Reloading: nothing changed for 1 min." Tick "Also compare the page text": Chrome asks permission for that site. |
| 4 | **Display hours:** tick "Only rotate during these hours", set today's hours to end 2 minutes from now. | Within 30 s of the end time: black "Outside display hours" screen, and "Outside display hours" in the log. Set the end time later again: back to rotation, and the black tab closes. |
| 5 | Try "A page" and "A different playlist" as off-hours content. | The page or playlist shows; the main playlist's tabs stay open behind it. |
| 6 | Set an overnight window, e.g. 22:00–06:00 on today's day, and change the time zone (e.g. `Asia/Tokyo`). | "Right now is inside/outside these hours" updates to match the clock in that zone. |
| 7 | **Settings lock:** set a PIN. Close Options. Click the toolbar icon. | Options opens at the PIN prompt instead of stopping rotation. While the prompt is on screen, rotation carries on and takes the screen back. |
| 8 | Enter a wrong PIN 5 times. | "Too many wrong PINs" for 1 min; "Wrong settings PIN entered" in the log. The right PIN unlocks, and rotation holds while you're in Options. |
| 9 | **Health log:** filter "Errors only", search for a URL, click **Export CSV**. | The CSV opens in Excel/Numbers/Sheets with one row per event and sortable UTC times. |

### Overnight soak additions

- [ ] Run the 12-hour soak with display hours on, ending in the evening and starting the next morning. Next morning: one "Outside display hours" and one "Display hours started" in the log, and rotation running.
- [ ] Leave the "Signed out" and "Error title" rules on during the soak; check the log for false positives.

## Milestone 3: alerts, fleet config, license keys (≈40 min)

Rebuild, reload the extension, and keep **Developer build: enable Pro** ticked (until the Polar store exists, that's how to test Pro). Set a **screen name** under "This screen" first.

| # | Do | Expect |
|---|---|---|
| 1 | **Alerts:** create a Slack incoming webhook (or Discord: channel → Integrations → Webhooks). Paste it, pick the format, allow the permission prompt, then click **Send test alert**. | "🔔 Test alert on <screen>: …" arrives in the channel. |
| 2 | Add the playlist entry `https://does-not-exist.invalid/` and wait ~7 min (it takes 5 failed reloads). | "🔴 Problem on <screen>: Still failing after 5 attempts" with the URL. Remove the entry: no further alerts. |
| 3 | Tick the daily "all OK" message and set the time to 2 minutes from now. | "💓 Daily check … Healthy: 0 incidents …" arrives at that time. Then it's scheduled for the same time tomorrow. |
| 4 | **Fleet config:** copy `docs/examples/screens.json` to a GitHub repo (or any web server). Rename one section to your screen name, remove the `license` and `lock` lines, and point the playlist at sites you can open. Paste its raw URL under Fleet config, allow the prompt, click **Check now**. | Within seconds the playlist, durations, detectors and alerts match the file; the banner says the screen is managed; the log shows "Applied fleet config for …". |
| 5 | Edit the file (change a URL), commit, and wait for the poll interval (set "Check every" to 1 minute to speed it up). | The screen picks up the change on its own; the tab for the old URL closes, and the new one opens. |
| 6 | Break the file (e.g. `"defaultDurationSec": "soon"`), commit. | The screen keeps its current settings; the log and the Fleet config section show "Config rejected … /screens/<name>/defaultDurationSec: must be integer"; an alert is sent. Fix the file: it applies again. |
| 7 | Set `"rotation": "stopped"` in the file, then `"running"`. | The screen stops, then starts, on its own. |
| 8 | **Export / import:** click **Export this screen's settings as JSON**, change something locally, then **Import JSON…** the exported file. | Settings return to what was exported. The exported file passes validation (open it in VS Code: no squiggles). |
| 9 | **License keys** (once the Polar store exists, see docs/payments-setup.md): untick developer Pro, paste a sandbox key, click **Activate on this screen**. | "Pro is active … This key covers N screens". **Deactivate this screen** releases it (check the activation is gone in Polar). |

### Overnight soak additions

- [ ] Leave alerts and the heartbeat on overnight. Next morning: one heartbeat in the channel, and an alert for every error in the health log (or a "+N held back" note).
- [ ] Leave fleet config polling every 5 min overnight, and edit the file once late in the evening. Next morning: one "Applied fleet config" entry for the edit, and no fetch errors (or only ones that match a real outage).
