import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { app } from '../src/index';
import { sha256 } from '../src/security';
let mf: Miniflare, env: any;
const service = 'https://comments.rurichan.work';
const origin = 'https://blog.rurichan.work';
const request = (path: string, init?: RequestInit) => app.request(service + path, init, env);
const submit = (data = {}, customOrigin = origin) => request('/api/v1/comments', { method: 'POST', headers: { Origin: customOrigin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' }, body: JSON.stringify({ articleId: 'path:/a/', author: '訪客', content: '<img src=x onerror=alert(1)>', token: 'test', requestId: crypto.randomUUID(), ...data }) });
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'], compatibilityDate: '2026-07-01' });
  const db = await mf.getD1Database('DB');
  const schema = await readFile('migrations/0001_initial.sql', 'utf8');
  await db.batch(schema.split(';').map(x => x.trim()).filter(Boolean).map(x => db.prepare(x)));
  env = { DB: db, ENVIRONMENT: 'production', SERVICE_ORIGIN: service, ALLOWED_ORIGINS: origin, RATE_LIMIT_SECRET: 'test-only', TURNSTILE_SECRET_KEY: 'test-only', COMMENTS_ENABLED: 'true' };
});
beforeEach(async () => {
  await env.DB.batch(['DELETE FROM comments', 'DELETE FROM articles', 'DELETE FROM rate_limits', 'DELETE FROM sessions'].map(s => env.DB.prepare(s)));
  await env.DB.prepare("INSERT INTO articles(id,path,title) VALUES ('path:/a/','/a/','A'),('path:/b/','/b/','B')").run();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, hostname: 'blog.rurichan.work', action: 'comment' })));
});
afterEach(() => { vi.unstubAllGlobals(); env.COMMENTS_ENABLED = 'true'; });
afterAll(async () => { await mf.dispose(); });
describe('Worker API with real local D1', () => {
  it('stores plain text and returns only public fields', async () => {
    expect((await submit()).status).toBe(201);
    const data = await (await request('/api/v1/comments?article=path:/a/')).json();
    expect(data.comments[0].content).toBe('<img src=x onerror=alert(1)>');
    expect(data.comments[0]).not.toHaveProperty('request_hash');
    expect(data.comments[0]).not.toHaveProperty('status');
  });
  it('deduplicates retries and rejects changed payloads', async () => {
    const requestId = crypto.randomUUID();
    const first = await (await submit({ requestId })).json();
    const retry = await (await submit({ requestId })).json();
    expect(retry.id).toBe(first.id); expect(retry.duplicate).toBe(true);
    expect((await submit({ requestId, content: 'changed' })).status).toBe(409);
  });
  it('rejects cross-article replies and unregistered articles', async () => {
    const first = await (await submit()).json();
    expect((await submit({ articleId: 'path:/b/', parentId: first.id })).status).toBe(400);
    expect((await submit({ articleId: 'path:/unknown/' })).status).toBe(404);
  });
  it('checks origin, honeypot, captcha hostname and captcha failure', async () => {
    expect((await submit({}, 'https://evil.example')).status).toBe(403);
    expect((await submit({ website: 'bot' })).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, hostname: 'evil.example', action: 'comment' })));
    expect((await submit()).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
    expect((await submit()).status).toBe(400);
  });
  it('rate limits repeated attempts and gates production during migration', async () => {
    env.COMMENTS_ENABLED = 'false'; expect((await submit()).status).toBe(503);
    env.COMMENTS_ENABLED = 'true';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
    for (let i = 0; i < 8; i++) await submit();
    expect((await submit()).status).toBe(429);
  });
  it('requires admin auth and same-origin writes; hide/restore/delete work', async () => {
    const { id } = await (await submit()).json();
    expect((await request('/api/v1/admin/me')).status).toBe(401);
    await env.DB.prepare('INSERT INTO sessions(hash,expires_at) VALUES (?,?)').bind(await sha256('test-session'), Math.floor(Date.now()/1000)+60).run();
    const headers = { Cookie: '__Host-bc_session=test-session', Origin: service, 'Content-Type': 'application/json' };
    expect((await request('/api/v1/admin/comments/'+id, { method:'PATCH', headers:{...headers,Origin:origin},body:'{"status":"hidden"}' })).status).toBe(403);
    expect((await request('/api/v1/admin/comments/'+id, { method:'PATCH', headers,body:'{"status":"hidden"}' })).status).toBe(200);
    expect((await (await request('/api/v1/comments?article=path:/a/')).json()).comments).toHaveLength(0);
    expect((await request('/api/v1/admin/comments/'+id, { method:'PATCH', headers,body:'{"status":"visible"}' })).status).toBe(200);
    expect((await request('/api/v1/admin/comments/'+id, { method:'DELETE', headers,body:'{}' })).status).toBe(200);
    const deleted = await env.DB.prepare('SELECT content,status FROM comments WHERE id=?').bind(id).first();
    expect(deleted).toEqual({ content:'', status:'deleted' });
  });
});
