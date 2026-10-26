import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';

export interface LoadedExtension {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

/** Launches Chromium with one unpacked extension loaded. Extensions require a persistent context. */
export async function launchWithExtension(distDir: string): Promise<LoadedExtension> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', // new headless mode, which (unlike the headless shell) supports extensions
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, serviceWorker, extensionId: new URL(serviceWorker.url()).host };
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Serves a fixtures directory, optionally with extra response headers (e.g. a strict CSP). */
export async function serveDirectory(
  dir: string,
  { host = 'localhost', headers = {} as Record<string, string> } = {},
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const file = path.join(dir, path.normalize(new URL(req.url!, 'http://x').pathname));
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...headers }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://${host}:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
