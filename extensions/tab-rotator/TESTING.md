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
