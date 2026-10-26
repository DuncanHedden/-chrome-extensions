// Usage: npx tsx extensions/regex-find/store/capture.ts
// Captures real 1280x800 store screenshots of the extension running on the demo pages in store/demo/.
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { buildExtension } from '../../../scripts/lib.ts';
import { launchWithExtension, serveDirectory } from '../../../testing/e2e.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'screenshots');
const CAPTION_HEIGHT = 110;

const server = await serveDirectory(path.join(here, 'demo'));
const ext = await launchWithExtension(await buildExtension('regex-find', { e2e: true }));
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const framer = await ext.context.newPage();

async function open(file: string): Promise<Page> {
  const page = await ext.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 - CAPTION_HEIGHT });
  await page.goto(`${server.origin}/${file}`);
  return page;
}

async function openBar(page: Page) {
  await page.bringToFront();
  await ext.serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await (globalThis as unknown as { openFindBar(t?: chrome.tabs.Tab): Promise<void> }).openFindBar(tab);
  });
  await page.locator('regex-find-bar').waitFor({ state: 'attached' });
}

async function search(page: Page, pattern: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(pattern);
  await page.waitForTimeout(400);
}

/** Composites a page capture under a caption band into a 1280x800 PNG. */
async function shoot(page: Page, name: string, caption: string) {
  const shot = await page.screenshot();
  const src = `data:image/png;base64,${shot.toString('base64')}`;
  await framer.setViewportSize({ width: 1280, height: 800 });
  await framer.setContent(`<body style="margin:0;width:1280px;height:800px;overflow:hidden;font-family:system-ui,-apple-system,sans-serif">
    <div style="height:${CAPTION_HEIGHT}px;display:flex;align-items:center;justify-content:center;gap:18px;background:#1a5fd0;color:#fff;font-size:38px;font-weight:700">
      <img src="data:image/png;base64,${(await readFile(path.join(here, '../public/icons/icon-128.png'))).toString('base64')}" width="64" height="64">${caption}</div>
    <img src="${src}" style="display:block;width:1280px;height:${800 - CAPTION_HEIGHT}px"></body>`);
  await framer.screenshot({ path: path.join(outDir, name) });
}

// 1. Regex over a build log
let page = await open('log.html');
await openBar(page);
await search(page, 'ERROR.*timeout after \\d+');
await shoot(page, '1-search-with-regex.png', 'Ctrl-F with regular expressions');

// 2. Many matches on a busy page
page = await open('tickets.html');
await openBar(page);
await search(page, '\\b(OPS|API)-\\d{4}\\b');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await shoot(page, '2-every-match-highlighted.png', 'Every match highlighted. Enter to jump.');

// 3. Whole-word toggle, zoomed in (CSS zoom on <html> also scales the bar) so the toggles are legible
page = await open('article.html');
await page.addStyleTag({ content: 'html{zoom:1.6}' });
await openBar(page);
await search(page, 'log');
await page.keyboard.press('Alt+KeyW');
await page.waitForTimeout(300);
await shoot(page, '3-whole-word-and-case-toggles.png', 'Match case, whole word, multiline');

// 4. Invalid pattern
await search(page, '(ERROR|WARN');
await shoot(page, '4-invalid-pattern-error.png', 'Typo in your regex? Clear error, no crash');

// 5. Options page
page = await ext.context.newPage();
await page.setViewportSize({ width: 1280, height: 800 - CAPTION_HEIGHT });
await page.goto(`chrome-extension://${ext.extensionId}/options/options.html`);
await page.addStyleTag({ content: 'html{zoom:1.25}' });
await page.waitForTimeout(300);
await shoot(page, '5-private-options.png', 'Private: runs entirely in your browser');

await ext.context.close();
await server.close();
console.log(`wrote ${outDir}`);
