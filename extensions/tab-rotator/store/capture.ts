// Usage: npx tsx extensions/tab-rotator/store/capture.ts
// Captures the five 1280x800 store screenshots from the real extension, using the demo dashboards in
// store/demo/ and seeded example settings (screen "NOC-Wall-1", a made-up "Acme Corp").
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { buildExtension, repoRoot } from '../../../scripts/lib.ts';
import { launchWithExtension, serveDirectory } from '../../../testing/e2e.ts';
import { DETECTOR_PRESETS } from '../src/engine/detectors.ts';
import { createLock } from '../src/lock.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'screenshots');
const W = 1280;
const H = 800;
const CAPTION = 110;
const PIN = '2468';

const server = await serveDirectory(path.join(here, 'demo'));
const ext = await launchWithExtension(await buildExtension('tab-rotator', { e2e: true }));
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const icon = (await readFile(path.join(here, '../public/icons/icon-128.png'))).toString('base64');
const framer = await ext.context.newPage();
const png = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

/** Caption band on top; `body` (HTML) fills the 1280x690 area below. */
async function frame(name: string, caption: string, body: string) {
  await framer.setViewportSize({ width: W, height: H });
  await framer.setContent(`<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;background:#eef1f4">
    <div style="height:${CAPTION}px;display:flex;align-items:center;justify-content:center;gap:18px;background:#137333;color:#fff;font-size:38px;font-weight:700">
      <img src="data:image/png;base64,${icon}" width="64" height="64">${caption}</div>
    <div style="height:${H - CAPTION}px;display:flex;align-items:center;justify-content:center;gap:24px;padding:0 28px;box-sizing:border-box">${body}</div></body>`);
  await framer.waitForTimeout(200);
  await framer.screenshot({ path: path.join(outDir, name) });
}
const shot = (src: string, style = '') => `<img src="${src}" style="max-height:${H - CAPTION - 40}px;max-width:100%;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);${style}">`;

// --- Seed: settings, Pro (developer), health log, fleet status ---
const dash = (n: string) => `${server.origin}/${n}.html`;
const lock = await createLock(PIN);
const now = Date.now();
const ago = (min: number) => now - min * 60_000;
const id = (i: number) => `seed-${i}`;
const presets = DETECTOR_PRESETS;
const ops = dash('ops');
const sales = dash('sales');
// What the log shows for the two demo dashboards.
const opsShown = 'https://dashboards.acme.example/ops-overview';
const salesShown = 'https://dashboards.acme.example/sales-floor';
const seed = {
  license: { pro: true, source: 'dev', checkedAt: now },
  settings: {
    screenName: 'NOC-Wall-1',
    source: 'playlist',
    defaultDurationSec: 30,
    playlist: [
      { id: id(1), url: ops, durationSec: 60, reloadBeforeShow: true },
      { id: id(2), url: sales, durationSec: null, reloadBeforeShow: false },
    ],
    tabRules: [],
    skipLoading: true,
    selfHeal: true,
    loadTimeoutSec: 60,
    pauseOnActivity: false,
    resumeAfterIdleSec: 60,
    autoStart: true,
    detectors: presets.map((p, i) => ({ ...p, id: id(10 + i) })),
    schedule: {
      // Off while capturing the rotating dashboard (it may be outside these hours right now);
      // switched on before the settings screenshots.
      enabled: false,
      timeZone: 'America/New_York',
      windows: [
        { id: 'w1', days: [1, 2, 3, 4, 5], start: '07:00', end: '19:00' },
        { id: 'w2', days: [6], start: '09:00', end: '13:00' },
      ],
      offHours: { kind: 'blank', url: '', entries: [] },
    },
    lock,
    alerts: { webhookUrl: 'https://hooks.slack.com/services/T0ACME/B0NOC/xxxxxxxxxxxxxxxx', format: 'slack', heartbeat: true, heartbeatTime: '08:30' },
    fleet: { configUrl: 'https://raw.githubusercontent.com/acme/screens/main/screens.json', authHeader: '', pollMinutes: 5 },
  },
  fleetStatus: {
    lastFetchAt: ago(1), lastAppliedAt: ago(3 * 60), appliedHash: 'x', etag: '', lastError: '', lastGoodText: '', screenFound: true,
  },
  healthLog: {
    entries: [
      { at: ago(14 * 60), level: 'info', code: 'config-applied', message: 'Applied fleet config for "NOC-Wall-1".', url: 'https://raw.githubusercontent.com/acme/screens/main/screens.json' },
      { at: ago(13 * 60), level: 'info', code: 'schedule-off', message: 'Outside display hours: showing off-hours content.' },
      { at: ago(11 * 60), level: 'info', code: 'late', message: 'Woke 2h 10m late (sleep, suspended browser or clock change); continuing.' },
      { at: ago(5 * 60 + 2), level: 'info', code: 'schedule-on', message: 'Display hours started: resuming rotation.' },
      { at: ago(4 * 60 + 40), level: 'warn', code: 'detector', message: 'Bad state "Signed out (login / SSO page)" detected; reopening.', url: 'https://login.acme-sso.example/auth?next=ops' },
      { at: ago(4 * 60 + 40), level: 'info', code: 'reopen', message: 'Reopening (attempt 1).', url: 'https://login.acme-sso.example/auth?next=ops' },
      { at: ago(4 * 60 + 39), level: 'info', code: 'recovered', message: 'Recovered after 1 attempt.', url: opsShown },
      { at: ago(3 * 60), level: 'info', code: 'config-applied', message: 'Applied fleet config for "NOC-Wall-1".', url: 'https://raw.githubusercontent.com/acme/screens/main/screens.json' },
      { at: ago(96), level: 'warn', code: 'crashed', message: 'Tab crashed.', url: salesShown },
      { at: ago(96), level: 'info', code: 'reload', message: 'Reloading (attempt 1).', url: salesShown },
      { at: ago(95), level: 'info', code: 'recovered', message: 'Recovered after 1 attempt.', url: salesShown },
      { at: ago(41), level: 'warn', code: 'load-error', message: 'Page failed to load (net::ERR_NAME_NOT_RESOLVED).', url: 'https://status.acme.example/' },
      { at: ago(41), level: 'info', code: 'reload', message: 'Reloading (attempt 1).', url: 'https://status.acme.example/' },
      { at: ago(40), level: 'info', code: 'reload', message: 'Reloading (attempt 2).', url: 'https://status.acme.example/' },
      { at: ago(39), level: 'info', code: 'recovered', message: 'Recovered after 2 attempts.', url: 'https://status.acme.example/' },
      { at: ago(12), level: 'warn', code: 'detector', message: 'Bad state "Frozen (nothing changed for 30 min)" detected; reloading.', url: opsShown },
      { at: ago(12), level: 'info', code: 'refresh', message: 'Reloading: nothing changed for 30 min.', url: opsShown },
    ],
  },
};
await ext.serviceWorker.evaluate((data) => chrome.storage.local.set(data), seed);

/** Options page, unlocked, with CSS zoom so sections read well at screenshot size. */
async function optionsPage(zoom = 1.4): Promise<Page> {
  const page = await ext.context.newPage();
  await page.setViewportSize({ width: 1100, height: 1400 });
  await page.goto(`chrome-extension://${ext.extensionId}/options/options.html`);
  await page.locator('#unlock-pin').fill(PIN);
  await page.locator('#unlock-form button').click();
  await page.locator('#settings').waitFor();
  // #grant-webhook only appears before the webhook permission is granted on a real screen.
  await page.addStyleTag({ content: `main{zoom:${zoom}} #saved,#grant-webhook{display:none!important}` });
  await page.waitForTimeout(400);
  return page;
}
const section = async (page: Page, selector: string) => png(await page.locator(selector).screenshot());

// 1. A dashboard on screen, plus the extension's status: rotating.
await ext.serviceWorker.evaluate(() => (globalThis as unknown as { tabRotator: { start(): Promise<unknown> } }).tabRotator.start());
// Wait for Tab Rotator to open its playlist tabs.
let tv: Page | undefined;
for (let i = 0; i < 50 && !tv; i++) {
  tv = ext.context.pages().find((p) => p.url().startsWith(ops));
  if (!tv) await new Promise((r) => setTimeout(r, 200));
}
if (!tv) throw new Error(`playlist tab never opened; pages: ${ext.context.pages().map((p) => p.url()).join(', ')}`);
await tv.setViewportSize({ width: 1224, height: 640 });
await tv.bringToFront();
const tvShot = png(await tv.screenshot());
const status = await optionsPage(1.3);
const statusShot = await section(status, '.status');
await frame('1-rotate-dashboards.png', 'Rotate dashboards on any TV, hands-free',
  `<div style="position:relative">${shot(tvShot)}
     <img src="${statusShot}" style="position:absolute;right:-8px;bottom:-14px;width:520px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)"></div>`);
await status.close();

// 2. Health log. (Display hours on from here, for screenshot 5.)
await ext.serviceWorker.evaluate(async () => {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings: { schedule: object } };
  await chrome.storage.local.set({ settings: { ...settings, schedule: { ...settings.schedule, enabled: true } } });
});
await new Promise((r) => setTimeout(r, 1000));
await ext.serviceWorker.evaluate((healthLog) => chrome.storage.local.set({ healthLog }), seed.healthLog);
const opts = await optionsPage(1.4);
await frame('2-health-log.png', 'Every problem and recovery, logged', shot(await section(opts, 'section[data-feature="healthLog"]')));

// 3. Fleet config: the file, and what the screen says about it.
const config = await readFile(path.join(repoRoot, 'docs/examples/screens.json'), 'utf8');
const code = await ext.context.newPage();
await code.setViewportSize({ width: 640, height: 640 });
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const highlighted = escapeHtml(config.split('\n').slice(0, 44).join('\n'))
  .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span style="color:#7ee787">$1</span>$2')
  .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#a5d6ff">$1</span>');
await code.setContent(`<body style="margin:0;background:#0d1117;color:#e6edf3"><div style="padding:6px 14px;background:#161b22;color:#8b949e;font:13px system-ui">acme/screens · screens.json</div>
  <pre style="margin:0;padding:12px 16px;font:12.5px/1.45 ui-monospace,Menlo,monospace;white-space:pre">${highlighted}</pre></body>`);
const codeShot = png(await code.screenshot());
await frame('3-fleet-config.png', 'Manage every screen from one file',
  `${shot(codeShot, 'width:540px')}${shot(await section(opts, 'section[data-feature="fleetConfig"]'), 'width:640px')}`);

// 4. Detectors and alerts.
await frame('4-detectors-alerts.png', 'Signed out? Frozen? Fixed, and you’re told',
  `${shot(await section(opts, 'section[data-feature="detectors"]'), 'width:600px')}${shot(await section(opts, 'section[data-feature="alerts"]'), 'width:600px')}`);

// 5. Display hours and settings lock.
await frame('5-display-hours-lock.png', 'Display hours and a PIN lock',
  `${shot(await section(opts, 'section[data-feature="schedules"]'), 'width:640px')}${shot(await section(opts, 'section[data-feature="settingsLock"]'), 'width:560px')}`);

await ext.context.close();
await server.close();
console.log(`wrote ${outDir}`);
