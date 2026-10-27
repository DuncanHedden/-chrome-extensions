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

| Host permission | Justification |
|---|---|
| `https://api.polar.sh/*` | Checks Pro license keys with Polar's license-key API (the payment provider): activation when the user enters a key, then about twice a day. Required at install, not optional, because keys can arrive through the fleet config file on screens where nobody is present to approve a prompt. Free users never contact it. |

**Optional permissions** (not granted at install; requested only when the user turns on a feature, and only for the specific addresses involved):

| Permission | Justification |
|---|---|
| `optional_host_permissions` (`https://*/*`, `http://*/*`) | Requested for **one specific origin at a time**, from the click that enables the feature: (1) the user's own **fleet config URL**, so the screen can download its settings file; (2) the user's own **alert webhook URL** (e.g. Slack/Teams), so it can post alerts; (3) the sites in the rotation, only if the user enables page-text comparison on a frozen-page rule. The broad patterns are declared only because these addresses are the user's own and aren't known in advance. |
| `scripting` (optional) | Only with (3) above: reads a hash of the visible page text, once a minute, to tell whether a dashboard has stopped updating. The text is never stored or sent anywhere. |

- **Remote code:** No.
- **Data usage:** collects no user data.

**Single purpose:** Automatically rotate between browser tabs on an unattended display, and keep that display working by recovering tabs that crash, fail to load or are closed.
