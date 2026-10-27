import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildExtension } from '../../../scripts/lib.ts';
import { launchWithExtension, serveDirectory, type LoadedExtension } from '../../../testing/e2e.ts';
import type { LogEntry, Settings } from '../src/engine/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let ext: LoadedExtension;
let server: Awaited<ReturnType<typeof serveDirectory>>;
const url = (name: string) => `${server.origin}/${name}.html`;

test.beforeAll(async () => {
  server = await serveDirectory(path.join(here, 'fixtures'));
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async () => {
  ext = await launchWithExtension(await buildExtension('tab-rotator', { e2e: true }));
});
test.afterEach(async () => {
  await ext?.context.close();
});

/** Calls into the service worker (see the end of src/background.ts). */
type Api = { tabRotator: Record<'start' | 'stop', () => Promise<unknown>> };

async function configure(patch: Partial<Settings>) {
  await ext.serviceWorker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), pauseOnActivity: false, ...p } });
  }, patch);
}

const start = () => ext.serviceWorker.evaluate(() => (globalThis as unknown as Api).tabRotator.start());
const stop = () => ext.serviceWorker.evaluate(() => (globalThis as unknown as Api).tabRotator.stop());
const healthLog = () =>
  ext.serviceWorker.evaluate(async () => {
    const { healthLog } = (await chrome.storage.local.get('healthLog')) as { healthLog?: { entries: LogEntry[] } };
    return healthLog?.entries ?? [];
  });
const tabs = () => ext.serviceWorker.evaluate(() => chrome.tabs.query({}));

test('three tabs at a 2 s interval rotate in order', async () => {
  await configure({ source: 'window', defaultDurationSec: 2 });
  await ext.serviceWorker.evaluate(async (urls) => {
    const [first] = await chrome.tabs.query({});
    for (const u of urls) await chrome.tabs.create({ url: u, windowId: first!.windowId });
    await chrome.tabs.remove(first!.id!); // leave exactly the three dashboards
    const [a] = await chrome.tabs.query({ url: urls[0] });
    await chrome.tabs.update(a!.id!, { active: true });
    const g = globalThis as unknown as { switches: [string, number][] };
    g.switches = [];
    chrome.tabs.onActivated.addListener(async ({ tabId }) => g.switches.push([(await chrome.tabs.get(tabId)).url!, Date.now()]));
  }, [url('a'), url('b'), url('c')]);

  await start();
  await expect
    .poll(() => ext.serviceWorker.evaluate(() => (globalThis as unknown as { switches: unknown[] }).switches.length), { timeout: 12_000 })
    .toBeGreaterThanOrEqual(4);
  const switches = await ext.serviceWorker.evaluate(() => (globalThis as unknown as { switches: [string, number][] }).switches);

  expect(switches.slice(0, 4).map(([u]) => u)).toEqual([url('b'), url('c'), url('a'), url('b')]);
  for (let i = 1; i < 4; i++) {
    const gap = switches[i]![1] - switches[i - 1]![1];
    expect(gap).toBeGreaterThan(1_700);
    expect(gap).toBeLessThan(2_700);
  }
  // Sub-30 s intervals run on the offscreen timer; stopping tears it and the alarms down.
  const contexts = () => ext.serviceWorker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length);
  expect(await contexts()).toBe(1);
  await stop();
  expect(await contexts()).toBe(0);
  expect(await ext.serviceWorker.evaluate(() => chrome.alarms.getAll())).toEqual([]);
  expect(await ext.serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
});

test('a playlist tab closed or crashed mid-rotation is healed and logged', async () => {
  const playlist = ['a', 'b', 'c'].map((n, i) => ({ id: `e${i}`, url: url(n), durationSec: null, reloadBeforeShow: false }));
  await configure({ source: 'playlist', defaultDurationSec: 2, playlist });
  await start();
  const playlistTabs = async () => (await tabs()).filter((t) => t.url?.startsWith(server.origin));
  await expect.poll(async () => (await playlistTabs()).length).toBe(3);
  expect(await ext.serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('ON');

  // Closed underneath us: reopened, and the health log says so.
  const victim = (await playlistTabs()).find((t) => t.url === url('b'))!;
  await ext.serviceWorker.evaluate((id) => chrome.tabs.remove(id), victim.id!);
  await expect.poll(async () => (await playlistTabs()).filter((t) => t.url === url('b')).length).toBe(1);
  expect((await playlistTabs()).find((t) => t.url === url('b'))!.id).not.toBe(victim.id);
  await expect.poll(async () => (await healthLog()).map((e) => e.code)).toContain('reopened');

  // Renderer crash (what chrome://crash does): detected, reloaded, recovered.
  const page = ext.context.pages().find((p) => p.url() === url('c'))!;
  const cdp = await ext.context.newCDPSession(page);
  void cdp.send('Page.crash').catch(() => {});
  await expect.poll(async () => (await healthLog()).map((e) => e.code), { timeout: 15_000 }).toEqual(
    expect.arrayContaining(['crashed', 'reload', 'recovered']),
  );
  const crash = (await healthLog()).find((e) => e.code === 'crashed')!;
  expect(crash.url).toBe(url('c'));
});

test('options: Pro sections are gated, the PIN lock works, and the health log exports as CSV', async () => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options/options.html`);

  // Free: Pro sections are greyed out and inert.
  await expect(page.locator('#plan')).toHaveText('Free');
  await expect(page.locator('section[data-feature="detectors"]')).toHaveClass(/locked/);
  await expect(page.locator('#add-detector')).toBeDisabled();
  await expect(page.locator('#log-export')).toBeDisabled();

  // Developer builds can switch Pro on for testing.
  await page.locator('#dev-pro-toggle').check();
  await expect(page.locator('#plan')).toHaveText('Pro (developer)');
  await expect(page.locator('#add-detector')).toBeEnabled();

  // Turn on the lock; a fresh visit needs the PIN, and wrong PINs are logged.
  await page.locator('#new-pin').fill('2468');
  await page.locator('#confirm-pin').fill('2468');
  await page.locator('#set-pin').click();
  await expect(page.locator('#lock-on')).toBeVisible();
  await page.reload();
  await expect(page.locator('#lock-gate')).toBeVisible();
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#toggle')).toBeHidden();
  await page.locator('#unlock-pin').fill('1111');
  await page.locator('#unlock-form button').click();
  await expect(page.locator('#unlock-error')).toHaveText('Wrong PIN.');
  await expect.poll(async () => (await healthLog()).map((e) => e.code)).toContain('lock-failed');
  await page.locator('#unlock-pin').fill('2468');
  await page.locator('#unlock-form button').click();
  await expect(page.locator('#settings')).toBeVisible();
  expect(page.url()).toMatch(/#unlocked$/);

  // CSV export of the log.
  const download = page.waitForEvent('download');
  await page.locator('#log-export').click();
  const csv = await (await (await download).createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf8');
  expect(text.split('\r\n')[0]).toBe('time_utc,local_time,screen,level,event,message,url');
  expect(text).toContain('lock-failed');
});
