import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const environment = process.argv[2];
if (!['staging', 'production'].includes(environment)) throw new Error('Select staging or production');
// This checked-in jsonc intentionally uses JSON syntax so tooling can validate it.
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const selected = config.env[environment];
if (JSON.stringify(selected).includes('REPLACE_')) throw new Error('Fill all environment placeholders before deploying');
if (!selected.vars.SERVICE_ORIGIN.startsWith('https://') || selected.vars.TURNSTILE_SITE_KEY.startsWith('1x000')) throw new Error('HTTPS origin and real Turnstile keys are required');
const run = args => { const r = spawnSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };
// Schema changes must be backwards compatible. Article sync is a separate, reviewed step.
run(['d1', 'migrations', 'apply', 'DB', '--remote', '--env', environment]);
run(['deploy', '--env', environment]);
