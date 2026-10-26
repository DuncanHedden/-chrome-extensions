import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extensionsDir = path.join(repoRoot, 'extensions');

interface BuildConfig {
  /** Output path (without .js, relative to dist) -> source entry (relative to the extension dir). */
  entries: Record<string, string>;
}

export interface BuildOptions {
  watch?: boolean;
  /**
   * Adds localhost host permissions so Playwright can inject without a real user gesture.
   * Never used for store builds; see DECISIONS.md.
   */
  e2e?: boolean;
}

export async function listExtensions(): Promise<string[]> {
  const names = await readdir(extensionsDir);
  return names.filter((n) => existsSync(path.join(extensionsDir, n, 'build.config.json'))).sort();
}

export function extensionDir(name: string) {
  return path.join(extensionsDir, name);
}

export async function readManifest(name: string): Promise<chrome.runtime.ManifestV3> {
  return JSON.parse(await readFile(path.join(extensionDir(name), 'manifest.json'), 'utf8'));
}

export async function buildExtension(name: string, opts: BuildOptions = {}): Promise<string> {
  const dir = extensionDir(name);
  const dist = path.join(dir, opts.e2e ? 'dist-e2e' : 'dist');
  const config: BuildConfig = JSON.parse(await readFile(path.join(dir, 'build.config.json'), 'utf8'));

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const copyStatic = async () => {
    await cp(path.join(dir, 'public'), dist, { recursive: true });
    const manifest = await readManifest(name);
    if (opts.e2e) manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://localhost/*'];
    await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  };

  const esbuildOptions: esbuild.BuildOptions = {
    entryPoints: Object.entries(config.entries).map(([out, src]) => ({ out, in: path.join(dir, src) })),
    outdir: dist,
    bundle: true,
    // Every entry is self-contained IIFE: content scripts injected via chrome.scripting can't be ES modules,
    // and keeping the service worker the same format means one mental model.
    format: 'iife',
    target: 'chrome100',
    // Unminified on purpose: Web Store reviewers read the code, and readable bundles review faster.
    minify: false,
    sourcemap: opts.watch ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
  };

  if (opts.watch) {
    const ctx = await esbuild.context({
      ...esbuildOptions,
      plugins: [{ name: 'copy-static', setup: (b) => b.onEnd(() => copyStatic()) }],
    });
    await ctx.watch();
  } else {
    await esbuild.build(esbuildOptions);
    await copyStatic();
  }
  return dist;
}
