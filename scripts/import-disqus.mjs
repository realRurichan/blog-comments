import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { validateManifest } from './manifest.mjs';
import { migrate, migrationSQL } from './disqus.mjs';
import { gunzipSync } from 'node:zlib';
const [input, manifest, output, option] = process.argv.slice(2);
if (!input || !manifest || !output || (option && option !== '--write-sql')) throw new Error('Usage: pnpm import:disqus EXPORT.xml MANIFEST.json work/import [--write-sql]');
const articles = validateManifest(JSON.parse(await readFile(manifest, 'utf8')));
const bytes = await readFile(input);
const xml = (input.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }) : bytes).toString('utf8');
const result = migrate(xml, articles);
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(`${output}/preview.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ total: result.total, importable: result.comments.length, excluded: result.excluded, unresolved: result.unresolved.length }));
if (option === '--write-sql') {
  if (result.unresolved.length) throw new Error('Resolve all unmatched comments before generating SQL. See preview.json.');
  await writeFile(`${output}/comments.sql`, migrationSQL(result.comments), { mode: 0o600 });
}
console.log('Preview saved. No database changed. Keep exports and previews out of git.');
