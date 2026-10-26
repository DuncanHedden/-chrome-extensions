import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { buildExtension } from '../../../scripts/lib.ts';
import { launchWithExtension, serveDirectory, type LoadedExtension } from '../../../testing/e2e.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let ext: LoadedExtension;
let main: Awaited<ReturnType<typeof serveDirectory>>;
let cross: Awaited<ReturnType<typeof serveDirectory>>;

test.beforeAll(async () => {
  const dist = await buildExtension('regex-find', { e2e: true });
  // Strict CSP on the test page: the find bar and highlight styles must still work.
  const csp = "default-src 'self'; style-src 'self'; frame-src 'self' http://127.0.0.1:*";
  main = await serveDirectory(path.join(here, 'fixtures'), { headers: { 'content-security-policy': csp } });
  cross = await serveDirectory(path.join(here, 'fixtures'), { host: '127.0.0.1' });
  ext = await launchWithExtension(dist);
});

test.afterAll(async () => {
  await ext?.context.close();
  await main?.close();
  await cross?.close();
});

async function openPage(): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(`${main.origin}/index.html?cross=${encodeURIComponent(cross.origin)}`);
  await expect.poll(() => page.frames().filter((f) => f.url().endsWith('frame.html')).length).toBe(2);
  await page.bringToFront();
  return page;
}

/** Same code path as the keyboard shortcut / toolbar click. */
async function triggerFindBar() {
  await ext.serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // Exposed by src/background.ts for tests.
    await (globalThis as unknown as { openFindBar(t?: chrome.tabs.Tab): Promise<void> }).openFindBar(tab);
  });
}

/** Text of each range in a highlight, read from the page's main world (the registry is shared). */
const highlighted = (target: Page | Frame, name: 'regex-find-match' | 'regex-find-current') =>
  target.evaluate((n) => [...(CSS.highlights.get(n) ?? [])].map((r) => String(r)), name);

test('highlights regex matches without mutating the page', async () => {
  const page = await openPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const before = await page.evaluate(() => document.body.innerHTML);

  await triggerFindBar();
  await expect(page.locator('regex-find-bar')).toHaveCount(1);
  await page.keyboard.type('A-\\d{4}');

  // Hidden "A-9999" is skipped; matches inside <b> are found.
  await expect.poll(() => highlighted(page, 'regex-find-match')).toEqual(['A-1001', 'A-1002', 'A-1003']);
  const sameOrigin = page.frames().find((f) => f.url().startsWith(main.origin) && f.url().endsWith('frame.html'))!;
  const crossOrigin = page.frames().find((f) => f.url().startsWith(cross.origin))!;
  expect(await highlighted(sameOrigin, 'regex-find-match')).toEqual(['A-2001']);
  expect(await highlighted(crossOrigin, 'regex-find-match')).toEqual([]);

  // Enter / Shift+Enter cycle, wrapping into the iframe.
  expect(await highlighted(page, 'regex-find-current')).toEqual(['A-1001']);
  await page.keyboard.press('Enter');
  expect(await highlighted(page, 'regex-find-current')).toEqual(['A-1002']);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  expect(await highlighted(page, 'regex-find-current')).toEqual([]);
  expect(await highlighted(sameOrigin, 'regex-find-current')).toEqual(['A-2001']);

  // Source whitespace/newlines collapse as rendered, so a plain space matches across the line break.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('shipped on 2024-02');
  await expect.poll(() => highlighted(page, 'regex-find-match')).toEqual(['shipped on\n       2024-02']);

  // Invalid regex: highlights clear, nothing throws.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('(unclosed');
  await expect.poll(() => highlighted(page, 'regex-find-match')).toEqual([]);

  // Keystrokes in the bar never reached the page's own keydown handler.
  expect(await page.evaluate(() => (window as unknown as { pageKeydowns: number }).pageKeydowns)).toBe(0);
  // The page DOM is untouched (the bar lives outside <body>).
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  expect(consoleErrors).toEqual([]);
  await page.close();
});

test('Esc closes, cleans up, and leaves the current match selected; reopening reuses one bar', async () => {
  const page = await openPage();
  await triggerFindBar();
  await triggerFindBar(); // second trigger refocuses instead of injecting a second bar
  await expect(page.locator('regex-find-bar')).toHaveCount(1);
  await page.keyboard.type('A-100[23]');
  await expect.poll(() => highlighted(page, 'regex-find-match')).toEqual(['A-1002', 'A-1003']);

  await page.keyboard.press('Escape');
  await expect(page.locator('regex-find-bar')).toHaveCount(0);
  expect(await page.evaluate(() => CSS.highlights.has('regex-find-match'))).toBe(false);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('A-1002');

  // Reopening pre-fills the last pattern (the selection is that pattern's own match, so it isn't used).
  await triggerFindBar();
  await expect.poll(() => highlighted(page, 'regex-find-match')).toEqual(['A-1002', 'A-1003']);
  await page.close();
});

test('pages that cannot be scripted get a badge instead of an error', async () => {
  const page = await ext.context.newPage();
  await page.goto('chrome://version');
  await triggerFindBar();
  const badge = await ext.serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab!.id });
  });
  expect(badge).toBe('!');
  await page.close();
});

test('options page loads settings and shows the shortcut', async () => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options/options.html`);
  await expect(page.locator('input[name="caseInsensitive"]')).toBeChecked();
  await expect(page.locator('#shortcut')).not.toHaveText('…');
  await page.locator('input[name="wholeWord"]').check();
  await page.reload();
  await expect(page.locator('input[name="wholeWord"]')).toBeChecked();
  await page.close();
});
