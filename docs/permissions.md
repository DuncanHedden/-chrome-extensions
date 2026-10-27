# Permission justifications

Paste these into the Web Store dashboard's **Privacy practices** tab. Keep this file in sync with each `manifest.json`.

## Regex Find

| Permission | Justification |
|---|---|
| `activeTab` | Gives temporary access to the current tab only when the user presses the extension's keyboard shortcut or clicks its toolbar icon, so the find bar can be shown on that page. No access to any other tab or site. |
| `scripting` | Injects the find bar script into the tab the user invoked it on (via `chrome.scripting.executeScript`). Used together with activeTab; there are no host permissions. |
| `storage` | Saves the user's preferences (default search flags, highlight colours) and an optional local history of their last 20 search patterns. |

- **Host permissions:** none.
- **Remote code:** No. All JavaScript is bundled in the package.
- **Data usage:** collects no user data (tick none of the data-type boxes; certify all three disclosures).

**Single purpose:** Search the text of the current web page with regular expressions and highlight the matches.

`<all_urls>`, `tabs`: not requested. (The e2e test build adds `http://localhost/*`; that build is never zipped. See DECISIONS.md.)

## Tab Rotator

| Permission | Justification |
|---|---|
| `tabs` | Reads the URL, loading status and crash state of tabs in the rotation window, so it can switch between them, skip tabs that are loading or crashed, and match playlist URLs to open tabs. Tab data never leaves the device. |
| `storage` | Saves the playlist, per-tab settings, rotation state (so rotation survives the service worker restarting) and a local health log of rotation events. |
| `alarms` | Wakes the extension to switch tabs on intervals of 30 seconds or more, and runs a watchdog that re-checks the rotation every 30 seconds while it is running. |
| `offscreen` | Runs a timer in a web worker inside an offscreen document to switch tabs on intervals shorter than 30 seconds, which chrome.alarms cannot do. Created only while rotation is running, and closed when it stops. |
| `idle` | Pauses rotation while someone is using the keyboard or mouse, and resumes after a configurable idle time, so the screen doesn't change under a person using it. |
| `webNavigation` | Detects when a rotated page fails to load (e.g. a DNS or connection error), so the extension can reload it with backoff instead of showing an error page on an unattended screen. Only main-frame errors for tabs in the rotation are used. |

**Optional permissions** (not granted at install; requested only when the user turns on the feature, and only for the sites involved):

| Permission | Justification |
|---|---|
| `scripting` + `optional_host_permissions` (`https://*/*`, `http://*/*`) | Only when the user enables "also compare the page text" on a frozen-page rule: Tab Rotator asks for access to the specific sites in their rotation, then reads a hash of the page's visible text once a minute to tell whether the dashboard has stopped updating. The text itself is never stored or sent anywhere. Milestone 3 will use the same mechanism to reach the user's own config URL and webhook URL. The broad patterns are listed only because the user's sites aren't known in advance; Chrome prompts for each specific origin. |

- **Host permissions at install:** none.
- **Remote code:** No.
- **Data usage:** collects no user data.

**Single purpose:** Automatically rotate between browser tabs on an unattended display, and keep that display working by recovering tabs that crash, fail to load or are closed.
