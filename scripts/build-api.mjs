// Produces the same Worker with its small assets embedded for multipart API deployments.
// Normal Wrangler deployments continue to use the ASSETS binding.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const files = {
  '/widget.js': ['dist/widget.js', 'text/javascript; charset=utf-8'],
  '/admin/': ['dist/admin/index.html', 'text/html; charset=utf-8'],
  '/admin/admin.js': ['dist/admin/admin.js', 'text/javascript; charset=utf-8'],
  '/admin/style.css': ['dist/admin/style.css', 'text/css; charset=utf-8'],
  '/demo/': ['dist/demo/index.html', 'text/html; charset=utf-8']
};
const assets = {};
for (const [path, [file, type]] of Object.entries(files)) assets[path] = { body: await readFile(file, 'utf8'), type };
const entry = `import worker from './src/index.ts';
const assets=${JSON.stringify(assets)};
export default {
  ...worker,
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, ASSETS: { async fetch(req) {
      const path=new URL(req.url).pathname;
      if (path==='/admin' || path==='/demo') return Response.redirect(new URL(path+'/', req.url), 308);
      const asset=assets[path.replace(/index\\.html$/, '')];
      if (!asset) return new Response('Not found', {status:404});
      const body=path.startsWith('/demo') ? asset.body.replace('http://localhost:8787', new URL(req.url).origin) : asset.body;
      return new Response(body, {headers:{'Content-Type':asset.type}});
    }}}, ctx);
  }
};`;
const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: 'api-entry.js' }, bundle: true, format: 'esm', target: 'es2022', minify: true, write: false });
await mkdir('work', { recursive: true });
await writeFile('work/worker.mjs', result.outputFiles[0].text);
console.log(`API bundle: ${result.outputFiles[0].contents.length} bytes`);
