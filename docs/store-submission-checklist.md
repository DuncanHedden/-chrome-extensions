# Chrome Web Store submission checklist

## One-time setup

- [ ] Register at <https://chrome.google.com/webstore/devconsole> and pay the **US$5 one-time** developer fee. Use a Google account you'll keep long-term; items can't be moved between accounts easily.
- [ ] Enable 2-Step Verification on that account (required to publish).
- [ ] Verify the developer contact email under **Account**.
- [ ] Declare **trader / non-trader** status (EU Digital Services Act). A free, donation-only extension can usually be non-trader. Once you charge money (Multi Forward Pro), you are a trader and your address and phone number are shown publicly on the listing. Consider a business address or virtual office before then.
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

- Review usually takes **1–3 days**. It can take longer for a new developer account, an extension that requests host permissions (Multi Forward: `mail.google.com`), or the first submission after a permission change.
- You get an email either way. You can choose to publish automatically on approval, or approve first and publish manually.

## If it's rejected

1. The email cites a policy and a **violation reference ID** (a colour + element name, e.g. "Purple Potassium"). Look the ID up on Chrome's *Troubleshooting Chrome Web Store violations* page; each has a specific fix. Common ones for us: Purple Potassium (excessive or unused permissions), Yellow Zinc (missing or poor listing metadata), Blue Argon (remote code under MV3), Red Titanium (obfuscated code; our bundles are unminified to avoid this), Purple Lithium (privacy policy / data disclosure).
2. If the reviewer is right: fix it, bump the version, upload, and resubmit. Mention the fix in the "notes to reviewer" field if one is shown.
3. If you think it's a mistake: appeal through the link in the email (One Stop Support). Keep it short and factual: quote the policy, say which file and line shows compliance, and reference `docs/permissions.md`. Appeals take days to weeks, so a quick compliant resubmit is often faster.
4. Repeated or severe violations can get the developer account suspended. Don't resubmit unchanged.
