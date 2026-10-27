# Tab Rotator — Privacy Policy

_Effective: 26 October 2026_

Tab Rotator is a browser extension that rotates between tabs on unattended displays and keeps those displays working.

## What we collect

Nothing. Tab Rotator has no analytics, telemetry, crash reporting or advertising, and the developer receives no data from your browser.

## What stays on your device

Your settings, rotation state and health log (a record of rotation events such as "tab crashed, reloaded") are stored in your browser with `chrome.storage.local`. They never leave the device unless you set up one of the features below. Uninstalling the extension deletes them.

Tab Rotator reads the URL, title and loading state of tabs in the window it rotates, only so it can rotate and repair them. If you turn on page-text comparison for a frozen-page rule, it reads a fingerprint (hash) of the visible text of the sites you approve, once a minute; the text itself is never stored or sent anywhere.

## Network requests Tab Rotator makes, and only when you set them up

- **Your fleet config URL** (Pro): the screen downloads the config file from the address you enter, with the Authorization header you provide, if any.
- **Your alert webhook** (Pro): when a screen has a problem it can't fix, recovers from one, or sends its daily heartbeat, it posts a short message to the webhook address you enter (e.g. your Slack, Teams or Discord). The message contains the screen name, a description of the event, and the URL of the affected page.
- **License checks** (Pro): when you activate a license key, and about twice a day afterwards, the extension sends the key and this screen's name to Polar's license API (`api.polar.sh`) to confirm it is valid. Polar processes purchases as merchant of record under [its own privacy policy](https://polar.sh/legal/privacy-policy). Free users never contact Polar.

Tab Rotator makes no other network requests. The dashboards you rotate load in normal browser tabs, as they would without the extension.

## Permissions

See [permissions.md](https://github.com/DuncanHedden/-chrome-extensions/blob/main/docs/permissions.md) for what each permission is used for.

## Changes

If this policy changes, the new version will be published at this URL with a new effective date.

## Contact

dmhedden123@gmail.com
