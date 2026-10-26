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

## Multi Forward for Gmail

_Not started._
