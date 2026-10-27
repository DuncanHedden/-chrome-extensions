# Fleet config: manage every screen from one file

With Tab Rotator Pro, each screen can read its settings from a JSON file you host: in a git repo, an S3 bucket, or on an internal web server. Change the file, commit it, and every screen picks up the change within a few minutes. Nobody needs to walk over to a TV.

## How it works

1. Each screen has a **screen name** (e.g. `NOC-Wall-1`) and a **config URL**. You set both once, on the screen itself.
2. Every few minutes (5 by default) the screen fetches the file.
3. The file is **validated** against a [JSON Schema](../packages/shared/schemas/tab-rotator-config.schema.json). If it's invalid, the screen **rejects it and keeps the last good config**, logs the exact problem ("`/screens/NOC-Wall-1/defaultDurationSec: must be integer`"), and sends an alert if alerts are set up. A typo never blanks a wall of TVs.
4. If it's valid, the screen applies `defaults`, then its own section under `screens`.
5. An unchanged file does nothing. Screens use `ETag` / `If-None-Match`, so polling an unchanged file costs one tiny request.

## Example: three screens

The full file is [`examples/screens.json`](examples/screens.json):

```json
{
  "$schema": "https://duncanhedden.github.io/-chrome-extensions/packages/shared/schemas/tab-rotator-config.schema.json",
  "version": 1,
  "defaults": {
    "rotation": "running",
    "source": "playlist",
    "defaultDurationSec": 30,
    "autoStart": true,
    "detectors": [
      { "name": "Signed out", "kind": "url", "pattern": "/\\/(login|signin|sso|saml|oauth2?)\\b/i", "action": "reopen" },
      { "name": "Gateway error", "kind": "title", "pattern": "/\\b50[234]\\b|session expired/i", "action": "reload" },
      { "name": "Frozen", "kind": "unchanged", "minutes": 30, "action": "reload" }
    ],
    "alerts": { "webhookUrl": "https://hooks.slack.com/services/…", "format": "slack", "heartbeat": true, "heartbeatTime": "08:30" },
    "lock": { "pin": "4826" },
    "license": { "key": "YOUR-LICENSE-KEY" }
  },
  "screens": {
    "NOC-Wall-1": {
      "playlist": [
        { "url": "https://grafana.example.com/d/infra-overview?kiosk", "durationSec": 60, "reloadBeforeShow": true },
        { "url": "https://grafana.example.com/d/k8s-clusters?kiosk" },
        { "url": "https://status.example.com/" }
      ]
    },
    "NOC-Wall-2": {
      "defaultDurationSec": 20,
      "playlist": [
        { "url": "https://app.datadoghq.com/dashboard/abc-123?tv_mode=true" },
        { "url": "https://example.atlassian.net/jira/software/projects/OPS/boards/1" }
      ]
    },
    "Lobby-1": {
      "defaultDurationSec": 15,
      "pauseOnActivity": false,
      "playlist": [{ "url": "https://intranet.example.com/welcome" }, { "url": "https://intranet.example.com/events" }],
      "schedule": {
        "enabled": true,
        "timeZone": "America/New_York",
        "windows": [{ "days": [1, 2, 3, 4, 5], "start": "07:00", "end": "19:00" }],
        "offHours": { "kind": "blank" }
      },
      "alerts": { "heartbeat": false }
    }
  }
}
```

The `$schema` line gives you autocomplete and inline errors in VS Code, JetBrains IDEs and most other editors.

## Setting up a screen (once per screen)

1. Install Tab Rotator, then open **Settings** (right-click the toolbar icon → Options).
2. Under **This screen**, set the **screen name**. It must match a key under `screens` exactly (it's case-sensitive). A screen with no section of its own just uses `defaults`, and the settings page says so.
3. Under **Fleet config**, paste the **config URL** and click **Check now**. Chrome asks permission to read that address; allow it.
4. If the file contains an alerts webhook, Chrome asks once more, for permission to post to it. The **Alerts** section shows an "Allow sending to this webhook" button until that's granted.
5. If the file contains a `license` key, the screen activates it on its own, using one activation per screen.

After that you never need to touch the screen again. To roll this out to many machines without clicking at all, see *Deploying with Chrome policy* below.

## Merge rules

- The screen applies `defaults`, then its own section on top.
- **Objects merge** key by key: a screen's `"schedule": { "timeZone": "Europe/London" }` keeps everything else from `defaults.schedule`.
- **Arrays replace**: a screen's `playlist` or `detectors` replaces the default list entirely.
- **Settings the file doesn't mention stay as set on the screen.** Anything the file *does* set wins the next time the file changes. Local edits to those settings last only until then, and the settings page shows a banner saying so.
- The file can never change the **screen name** or **config URL**. Those belong to the screen, so a bad edit can't orphan it.

## Reference

Every field is optional, in `defaults` and in each screen section alike.

| Field | Type | Meaning |
|---|---|---|
| `rotation` | `"running"` \| `"stopped"` | Start or stop rotation remotely. |
| `source` | `"playlist"` \| `"window"` | Rotate the playlist below, or whatever tabs are open. |
| `defaultDurationSec` | integer 2–86400 | Seconds per item unless overridden. |
| `playlist` | array of `{ url, durationSec?, reloadBeforeShow? }` | What to show, in order. Tab Rotator opens these tabs and keeps them open. |
| `tabRules` | array of `{ urlPrefix, durationSec?, reloadBeforeShow? }` | Per-tab settings in `window` mode. |
| `skipLoading`, `selfHeal` | boolean | Skip tabs still loading; reload crashed/failed tabs with backoff. |
| `loadTimeoutSec` | integer 10–600 | A page still loading after this long counts as failed. |
| `pauseOnActivity`, `resumeAfterIdleSec` | boolean, integer 15–3600 | Pause while someone uses the machine. |
| `autoStart` | boolean | Start rotating when Chrome starts. |
| `detectors` | array of `{ name, kind, action, pattern?, minutes?, appliesTo?, enabled?, checkContent? }` | Bad-state rules. `kind`: `url`, `title`, `unchanged`. `action`: `reload`, `reopen`, `skip`, `alert`. `pattern`: text, or `/regex/flags`. |
| `schedule` | `{ enabled, timeZone, windows: [{ days, start, end }], offHours: { kind, url?, playlist? } }` | Display hours. `days`: 0 = Sunday … 6 = Saturday. A window with `end` ≤ `start` runs past midnight. `offHours.kind`: `blank`, `page`, `playlist`. |
| `alerts` | `{ webhookUrl, format, heartbeat, heartbeatTime }` | `format`: `slack`, `teams`, `discord`, `json`. An empty `webhookUrl` turns alerts off. |
| `lock` | `{ pin }` or `{ enabled: false }` | PIN-lock the settings page and start/stop. Stored hashed on the screen. |
| `license` | `{ key }` | Pro license key. Each screen activates it once. |
| `pollMinutes` | integer 1–1440 | How often screens re-check this file. |

## Hosting the file

Anywhere that serves the file over HTTPS works.

- **GitHub (recommended: you get history, review and rollback).** Public repo: use the raw URL, e.g. `https://raw.githubusercontent.com/acme/screens/main/screens.json`. Private repo: create a fine-grained token with read-only *Contents* access to that one repo, and on each screen set **Authorization header** to `Bearer github_pat_…`. GitHub's raw CDN caches for up to ~5 minutes, so changes land within poll interval + 5 min.
- **S3 / GCS:** use a private object with a long-lived pre-signed URL, or a bucket restricted to your office's IP range. No CORS setup is needed: the extension has its own permission for the URL.
- **Internal server:** any static file server. Put it behind your SSO only if screens can authenticate with a static header (most SSO redirects can't be followed by a background fetch).

**Keep the file private if it contains a `license` key, a `lock.pin`, or a webhook URL.** Anyone with the file can use them.

## When things go wrong

| You see (health log / alert) | Meaning |
|---|---|
| `Config rejected (keeping the last good one): /screens/Lobby-1/schedule/windows/0/start: must match …` | The file has an error at that path. Fix it and commit; screens pick it up on the next poll. |
| `Couldn't fetch fleet config (HTTP 404)` | Wrong URL, or a missing or expired token. The screen keeps its current settings. |
| `Applied fleet config defaults; no section for "Lobby-01"` | The screen name doesn't match a key under `screens` (check spelling and case). |
| `Alert not sent: open Settings on this screen and grant access to hooks.slack.com` | The webhook came from the file, but nobody has allowed it on this screen yet (setup step 4). |
| `License key rejected: … activation limit reached` | More screens than the key covers. Deactivate an old screen in its settings, or buy more. |

Both the **Fleet config** section and the health log show the last check, the last apply, and the last error.

## Deploying with Chrome policy (zero-touch)

On managed machines (Google Admin console, Windows GPO / Intune, or a macOS configuration profile), you can force-install Tab Rotator with `ExtensionInstallForcelist`, so nobody has to install it by hand. Managed pre-configuration of the screen name and config URL (via Chrome's `3rdparty` extension policy) is on the roadmap; for now, steps 2–3 above are one-time per screen. See [kiosk-setup.md](kiosk-setup.md) for the rest of a hands-off screen build.
