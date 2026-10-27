# Tab Rotator Pro: payments setup (Polar)

Tab Rotator sells Pro as **license keys** through [Polar](https://polar.sh). Polar is the merchant of record: it handles checkout, cards, sales tax / VAT and invoices. The extension checks keys against Polar's public License Key API directly, so there's no server for you to run. Check Polar's pricing page for current fees.

A key covers **N screens**. Each screen *activates* the key once, labelled with its screen name, and Polar enforces the key's activation limit. Customers manage fleets by putting the key in their [fleet config](remote-config.md).

## One-time setup (~30 min)

1. Sign up at <https://polar.sh> and create an **organization** named **Hedden Software**. Complete the payout / identity onboarding before going live.
2. **Benefits → New benefit → License Keys**, one benefit per screen bundle, e.g.:
   - "Tab Rotator Pro – 1 screen": **activations required**, limit **1**
   - "Tab Rotator Pro – 5 screens": limit **5**
   - "Tab Rotator Pro – 25 screens": limit **25**

   Leave expiry off: for subscriptions, Polar revokes the key when the subscription ends, and lifetime keys should never expire. Optionally allow customers to deactivate their own activations.
3. **Products:** one product per bundle and billing type, each granting the matching benefit. Per-screen prices from `extensions/tab-rotator/src/pricing.ts` ($4/month, $36/year, $69 lifetime, per screen) give, for example:
   - 1 screen: $4/month, $36/year, or $69 once
   - 5 screens: $20/month, $180/year, or $345 once (or discount it, say $299)
   - 25 screens: $100/month, $900/year, or a volume price of your choosing

   Start with the 1-screen product if you like; bundles can be added later without changing the extension, as long as you add their benefit IDs (step 4).
4. Copy into `extensions/tab-rotator/src/pricing.ts` → `POLAR`:
   - `organizationId`: Settings → General (the organization ID, a UUID).
   - `benefitIds`: each license-key benefit's ID (Benefits → ⋯ → Copy ID). Only keys granted by these benefits unlock Pro. Leave the list empty to accept any license-key benefit in the organization.
   - `checkout.monthly / yearly / lifetime`: the checkout links for the 1-screen products (Products → ⋯ → Checkout link). The website's Buy buttons can link to the bundles.
5. **Test in the Polar sandbox** (<https://sandbox.polar.sh>), which has its own organization ID and API at `sandbox-api.polar.sh`. For a sandbox test build, temporarily add `apiBase: 'https://sandbox-api.polar.sh/v1/customer-portal/license-keys'` to `POLAR` in `src/pricing.ts`, and `https://sandbox-api.polar.sh/*` to the manifest's `host_permissions`. Buy with a Stripe test card, paste the key on the options page, check "Pro is active … This key covers 1 screen", then **Deactivate this screen** and check the activation disappears in Polar.

## How validation behaves

- **Activation:** when someone pastes a key, or a fleet config supplies one. One activation per screen; re-activating the same key on the same screen is a no-op.
- **Re-validation:** every 12 hours, against this screen's activation. A revoked or expired key, or an activation deleted in the Polar dashboard, turns Pro off at once, logs an error, and sends an alert if alerts are configured.
- **Offline:** if Polar can't be reached (network error, 5xx, rate limiting), Pro **stays on for 14 days** after the last successful check, so an outage never turns features off on an unattended screen.
- **Scoping:** Polar only accepts keys from our organization. The extension additionally checks the key's benefit and frees the activation of any key for a different product.
- **Developer builds** (loaded unpacked) also show a "Developer build: enable Pro" switch. Store installs never honour it.

## History

ExtensionPay was the original plan, but its library is AGPL-3.0 and it licenses per Chrome profile. Lemon Squeezy was next, but it closed to new sellers while moving to Stripe Managed Payments, which has no license keys. See DECISIONS.md.
