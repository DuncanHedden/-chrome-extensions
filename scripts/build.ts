// Usage: tsx scripts/build.ts [extension...] [--watch] [--e2e]
import path from 'node:path';
import { buildExtension, listExtensions, repoRoot } from './lib.ts';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const e2e = args.includes('--e2e');
const names = args.filter((a) => !a.startsWith('--'));
const targets = names.length ? names : await listExtensions();

for (const name of targets) {
  const dist = await buildExtension(name, { watch, e2e });
  console.log(`${watch ? 'watching' : 'built'} ${name} -> ${path.relative(repoRoot, dist)}`);
}
if (watch) console.log('Rebuilds on save. Click the reload icon in chrome://extensions to pick up changes.');
