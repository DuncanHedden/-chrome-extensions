# Tab Rotator Pro: payments setup (Lemon Squeezy)

Tab Rotator sells Pro as **license keys** through Lemon Squeezy. Lemon Squeezy is the merchant of record: it handles checkout, cards, sales tax / VAT and invoices. The extension checks keys against Lemon Squeezy's public License API directly, so there's no server for you to run.

A key covers **N screens**. Each screen *activates* the key once, under its screen name, and Lemon Squeezy enforces the activation limit. Customers manage fleets by putting the key in their [fleet config](remote-config.md).

## One-time setup (~30 min)

1. Create an account at <https://lemonsqueezy.com> and a **store**. Complete identity and payout verification; you can't sell until it's approved.
2. **Products → New product → "Tab Rotator Pro"**. Create one **variant per plan**, using the prices in `extensions/tab-rotator/src/pricing.ts`:
   - Monthly: subscription, $4 / month
   - Yearly: subscription, $36 / year
   - Lifetime: single payment, $69
3. On each variant, turn on **Generate license keys**:
   - **Activation limit** = number of screens the purchase covers. For per-screen pricing, enable **quantity** at checkout and set the activation limit per unit. Check in a test purchase that the limit scales with quantity. If it doesn't, sell fixed bundles instead (variants for 1, 5, 25 and 100 screens) and price them accordingly.
   - **Expiry:** for the subscription variants, tie keys to the subscription, so a cancelled or unpaid subscription makes `validate` return expired. Lifetime keys never expire.
4. Copy three things into `extensions/tab-rotator/src/pricing.ts` → `LEMON_SQUEEZY`:
   - `storeId`: Settings → Stores (the numeric ID).
   - `productIds`: the product's numeric ID (Products → ⋯ → Copy ID).
   - `checkout.monthly / yearly / lifetime`: each variant's **Share → Checkout link**.
5. Rebuild and test in **test mode**: buy with a Stripe test card, paste the key on the options page, and check "Pro is active … 1 of N screens used". Then click **Deactivate this screen** and check the activation is released in the Lemon Squeezy dashboard.

## How validation behaves

- **Activation:** when someone pastes a key, or a fleet config supplies one. One activation per screen; re-activating the same key on the same screen is a no-op.
- **Re-validation:** every 12 hours. An expired, disabled or refunded key turns Pro off, logs an error, and sends an alert if alerts are configured.
- **Offline:** if the license server can't be reached, Pro **stays on for 14 days** after the last successful check. A network outage never turns features off on a screen nobody is watching.
- **Wrong product:** keys from another Lemon Squeezy store or product are refused, and the activation slot they took is released immediately.
- **Developer builds** (loaded unpacked) also show a "Developer build: enable Pro" switch. Store installs never honour it.

## Why not ExtensionPay

It was the original plan, but its client library is AGPL-3.0, which would force the extension to be distributed under AGPL. It also licenses per Chrome profile, which means a checkout or login on every TV. See DECISIONS.md.
