// Usage: tsx scripts/render-assets.ts [extension...]
// Renders assets/icon.svg to public/icons/icon-{16,32,48,128}.png, plus placeholder 1280x800 screenshots and a
// 440x280 promo tile from store/screenshots.json. Replace the screenshots with real captures before submitting.
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { extensionDir, listExtensions } from './lib.ts';

interface ScreenshotSpec {
  accent: string;
  title: string;
  screenshots: string[];
  promo: string;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function card(spec: ScreenshotSpec, iconSvg: string, caption: string, index: number | null, w: number, h: number) {
  const big = w > 600;
  return `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:${big ? 32 : 14}px;background:linear-gradient(160deg,#f8f9fa,#e8f0fe);
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#202124;text-align:center">
    <div style="width:${big ? 160 : 88}px;height:${big ? 160 : 88}px">${iconSvg.replace('<svg', '<svg width="100%" height="100%"')}</div>
    <div style="font-size:${big ? 56 : 26}px;font-weight:700;max-width:${w - 120}px;line-height:1.15">${escape(caption)}</div>
    <div style="font-size:${big ? 24 : 14}px;color:${spec.accent};font-weight:600">${escape(spec.title)}</div>
    ${index === null ? '' : `<div style="position:absolute;top:24px;right:32px;font-size:20px;color:#9aa0a6">PLACEHOLDER ${index + 1}/5 - replace with a real 1280x800 capture</div>`}
  </body></html>`;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : await listExtensions();
const browser = await chromium.launch();
const page = await browser.newPage();

for (const name of names) {
  const dir = extensionDir(name);
  const iconPath = path.join(dir, 'assets/icon.svg');
  if (!existsSync(iconPath)) continue;
  const iconSvg = await readFile(iconPath, 'utf8');

  await mkdir(path.join(dir, 'public/icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0">${iconSvg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body>`);
    await page.screenshot({ path: path.join(dir, `public/icons/icon-${size}.png`), omitBackground: true });
  }

  const specPath = path.join(dir, 'store/screenshots.json');
  if (existsSync(specPath)) {
    const spec: ScreenshotSpec = JSON.parse(await readFile(specPath, 'utf8'));
    await mkdir(path.join(dir, 'store/screenshots'), { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [i, caption] of spec.screenshots.entries()) {
      await page.setContent(card(spec, iconSvg, caption, i, 1280, 800));
      await page.screenshot({ path: path.join(dir, `store/screenshots/${i + 1}-${slug(caption)}.png`) });
    }
    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(card(spec, iconSvg, spec.promo, null, 440, 280));
    await page.screenshot({ path: path.join(dir, 'store/promo-small-440x280.png') });
  }
  console.log(`rendered assets for ${name}`);
}
await browser.close();
