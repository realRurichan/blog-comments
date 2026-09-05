import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateManifest, articleSQL } from './manifest.mjs';
const [manifest, output] = process.argv.slice(2);
if (!manifest || !output) throw new Error('Usage: pnpm articles MANIFEST.json work/articles.sql');
const articles = validateManifest(JSON.parse(await readFile(manifest, 'utf8')));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, articleSQL(articles), { mode: 0o600 });
console.log(`Prepared ${articles.length} articles. SQL written to ${output}; no database changed.`);
