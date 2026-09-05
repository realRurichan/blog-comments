import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
it('accepts a real gzip export containing threads but no comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blog-comments-import-'));
  try {
    const xml = '<?xml version="1.0"?><disqus xmlns="http://disqus.com" xmlns:dsq="http://disqus.com/disqus-internals"><thread dsq:id="123"><link>https://blog.example/a/</link></thread></disqus>';
    writeFileSync(join(dir, 'export.xml.gz'), gzipSync(xml));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({version:1, articles:[{id:'path:/a/',path:'/a/',title:'A'}]}));
    execFileSync(process.execPath, ['scripts/import-disqus.mjs', join(dir, 'export.xml.gz'), join(dir, 'manifest.json'), join(dir, 'preview'), '--write-sql']);
    const result = JSON.parse(readFileSync(join(dir, 'preview/preview.json'), 'utf8'));
    expect(result).toEqual({total:0, excluded:0, comments:[], unresolved:[]});
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
