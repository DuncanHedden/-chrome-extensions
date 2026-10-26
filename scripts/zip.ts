// Usage: tsx scripts/zip.ts <extension> [--expect-version x.y.z]
// Builds the extension and writes release/<extension>-<version>.zip, ready to upload to the Web Store.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { buildExtension, listExtensions, readManifest, repoRoot } from './lib.ts';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const expectIdx = args.indexOf('--expect-version');
const expectVersion = expectIdx >= 0 ? args[expectIdx + 1] : undefined;

const known = await listExtensions();
if (!name || !known.includes(name)) {
  console.error(`Usage: tsx scripts/zip.ts <${known.join('|')}> [--expect-version x.y.z]`);
  process.exit(1);
}

const manifest = await readManifest(name);
if (expectVersion && manifest.version !== expectVersion) {
  console.error(`manifest.json version ${manifest.version} does not match tag version ${expectVersion}`);
  process.exit(1);
}

const dist = await buildExtension(name);

async function collect(dir: string, files: Record<string, Uint8Array> = {}) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) await collect(full, files);
    else if (entry !== '.DS_Store') files[path.relative(dist, full).split(path.sep).join('/')] = await readFile(full);
  }
  return files;
}

const files = await collect(dist);
// Fixed mtime keeps the zip byte-identical across rebuilds of the same source.
const zipped = zipSync(files, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') });
const outDir = path.join(repoRoot, 'release');
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, `${name}-${manifest.version}.zip`);
await writeFile(out, zipped);
console.log(`${path.relative(repoRoot, out)} (${Object.keys(files).length} files, ${(zipped.length / 1024).toFixed(1)} KiB)`);
