import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/admin', { recursive: true });
await cp('web/admin/index.html', 'dist/admin/index.html');
await cp('web/admin/style.css', 'dist/admin/style.css');
await cp('web/demo', 'dist/demo', { recursive: true });
await build({ entryPoints: { widget: 'web/widget.js', 'admin/admin': 'web/admin/admin.js' }, outdir: 'dist', bundle: true, format: 'esm', target: 'es2022', minify: true });
