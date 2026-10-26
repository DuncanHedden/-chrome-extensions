// Usage: tsx scripts/render-assets.ts [extension...]
// Renders assets/icon.svg to public/icons/icon-{16,32,48,128}.png and a 440x280 promo tile from store/promo.json.
// Store screenshots are real captures from each extension's store/capture.ts, not generated here.
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { extensionDir, listExtensions } from './lib.ts';

interface PromoSpec {
  accent: string;
  title: string;
  promo: string;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

function card(spec: PromoSpec, iconSvg: string, caption: string, w: number, h: number) {
  const big = w > 600;
  return `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:${big ? 32 : 14}px;background:linear-gradient(160deg,#f8f9fa,#e8f0fe);
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#202124;text-align:center">
    <div style="width:${big ? 160 : 88}px;height:${big ? 160 : 88}px">${iconSvg.replace('<svg', '<svg width="100%" height="100%"')}</div>
    <div style="font-size:${big ? 56 : 26}px;font-weight:700;max-width:${w - 120}px;line-height:1.15">${escape(caption)}</div>
    <div style="font-size:${big ? 24 : 14}px;color:${spec.accent};font-weight:600">${escape(spec.title)}</div>
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

  const specPath = path.join(dir, 'store/promo.json');
  if (existsSync(specPath)) {
    const spec: PromoSpec = JSON.parse(await readFile(specPath, 'utf8'));
    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(card(spec, iconSvg, spec.promo, 440, 280));
    await page.screenshot({ path: path.join(dir, 'store/promo-small-440x280.png') });
  }
  console.log(`rendered assets for ${name}`);
}
await browser.close();
