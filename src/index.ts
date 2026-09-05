import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Bindings } from './types';
import { consumeLimit, cookieName, decodeCursor, encodeCursor, ipHash, local, nowSeconds, origins, randomToken, sha256 } from './security';

export const app = new Hono<AppEnv>();
const publicFields = 'c.id,c.article_id,c.parent_id,c.author,c.content,c.created_at,CASE WHEN p.status=\'visible\' THEN p.author ELSE NULL END AS parent_author';

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const origin = c.req.header('Origin');
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Origin');
    if (origin && origin !== c.env.SERVICE_ORIGIN && !origins(c).includes(origin)) return c.json({ error: '此網站尚未獲准使用評論服務。' }, 403);
    if (origin) c.header('Access-Control-Allow-Origin', origin);
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      return c.body(null, 204);
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const admin = c.req.path.startsWith('/api/v1/admin/') || c.req.path.startsWith('/auth/');
    if (!origin || (admin ? origin !== c.env.SERVICE_ORIGIN : ![c.env.SERVICE_ORIGIN, ...origins(c)].includes(origin))) return c.json({ error: '來源驗證失敗。' }, 403);
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: '請使用 JSON。' }, 415);
  }
  await next();
});
app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: '內容過長。' }, 413) }));
app.onError((error, c) => {
  // Never log request bodies, cookies, IP addresses, or OAuth codes.
  console.error('request_failed', { path: c.req.path, type: error.name });
  return c.json({ error: '服務暫時無法使用，請稍後重試。' }, 503);
});
app.get('/health', async c => {
  await c.env.DB.prepare('SELECT id FROM articles LIMIT 1').first();
  return c.json({ ok: true });
});
app.get('/api/v1/config', c => c.json({ siteKey: c.env.TURNSTILE_SITE_KEY, maxName: 40, maxContent: 4000, enabled: c.env.COMMENTS_ENABLED !== 'false' }));
app.get('/api/v1/comments', async c => {
  const article = c.req.query('article');
  if (!article || article.length > 2200) return c.json({ error: '文章識別碼無效。' }, 400);
  if (!await c.env.DB.prepare('SELECT id FROM articles WHERE id=? AND enabled=1').bind(article).first()) return c.json({ error: '這篇文章尚未開放評論。' }, 404);
  let cursor: [string, string];
  try { cursor = decodeCursor(c.req.query('cursor')); } catch { return c.json({ error: '分頁參數無效。' }, 400); }
  const { results } = await c.env.DB.prepare(`SELECT ${publicFields} FROM comments c LEFT JOIN comments p ON c.parent_id=p.id WHERE c.article_id=? AND c.status='visible' AND (c.created_at,c.id)>(?,?) ORDER BY c.created_at,c.id LIMIT 21`).bind(article, ...cursor).all<{ id: string; created_at: string }>();
  return c.json({ comments: results.slice(0, 20), nextCursor: results.length > 20 ? encodeCursor(results[19]) : null });
});
app.post('/api/v1/comments', async c => {
  if (c.env.COMMENTS_ENABLED === 'false') return c.json({ error: '評論正在準備中，請待舊評論遷移完成後再留言。' }, 503);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return c.json({ error: '內容格式無效。' }, 400); }
  if (!data || typeof data !== 'object') return c.json({ error: '內容格式無效。' }, 400);
  const { articleId, author, content, parentId = null, requestId, token, website = '' } = data;
  if (typeof articleId !== 'string' || articleId.length > 2200 || typeof author !== 'string' || !author.trim() || author.trim().length > 40 || typeof content !== 'string' || !content.trim() || content.trim().length > 4000 || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) || (parentId !== null && (typeof parentId !== 'string' || parentId.length > 100)) || typeof token !== 'string' || token.length > 2048 || typeof website !== 'string' || website !== '') return c.json({ error: '請檢查暱稱、留言及驗證資料。' }, 400);
  if (!c.env.RATE_LIMIT_SECRET || !c.env.TURNSTILE_SECRET_KEY) return c.json({ error: '評論服務尚未設定完成。' }, 503);
  const ip = c.req.header('CF-Connecting-IP') || (local(c) ? 'local' : '');
  if (!ip) return c.json({ error: '無法驗證請求來源。' }, 403);
  const digest = await ipHash(c.env.RATE_LIMIT_SECRET, ip);
  const stamp = nowSeconds();
  const permitted = await consumeLimit(c.env.DB, `minute:${digest}:${Math.floor(stamp / 60)}`, stamp + 120, 8);
  if (!permitted) { c.header('Retry-After', '60'); return c.json({ error: '提交太頻繁，請一分鐘後重試。' }, 429); }
  const requestHash = await sha256(JSON.stringify([articleId, author.trim(), content.trim(), parentId, digest]));
  const previous = await c.env.DB.prepare('SELECT id,request_hash FROM comments WHERE request_id=?').bind(requestId).first<{ id: string; request_hash: string }>();
  if (previous) return previous.request_hash === requestHash ? c.json({ id: previous.id, duplicate: true }) : c.json({ error: '提交識別碼已使用，請重新提交。' }, 409);
  if (!await c.env.DB.prepare('SELECT id FROM articles WHERE id=? AND enabled=1').bind(articleId).first()) return c.json({ error: '這篇文章尚未開放評論。' }, 404);
  if (parentId && !await c.env.DB.prepare("SELECT id FROM comments WHERE id=? AND article_id=? AND status='visible'").bind(parentId, articleId).first()) return c.json({ error: '回覆對象已不存在，請取消回覆後重試。' }, 400);
  if (!await consumeLimit(c.env.DB, `hour:${digest}:${Math.floor(stamp / 3600)}`, stamp + 7200, 30)) { c.header('Retry-After', '3600'); return c.json({ error: '已達每小時提交上限，請稍後重試。' }, 429); }
  let verification: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: c.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Turnstile unavailable');
    verification = await response.json();
  } catch { return c.json({ error: '驗證服務暫時無法連線，留言已保留，請重試。' }, 503); }
  const hostname = new URL(c.req.header('Origin')!).hostname;
  if (!verification.success || (!local(c) && (verification.hostname !== hostname || verification.action !== 'comment'))) return c.json({ error: '驗證未通過或已過期，請重新驗證。' }, 400);
  const id = crypto.randomUUID();
  // Recheck parent and article at insert time; one statement closes moderation races.
  const inserted = await c.env.DB.prepare(`INSERT INTO comments(id,article_id,parent_id,author,content,created_at,request_id,request_hash)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM articles WHERE id=? AND enabled=1)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM comments WHERE id=? AND article_id=? AND status='visible'))
    ON CONFLICT(request_id) DO NOTHING RETURNING id`).bind(id, articleId, parentId, author.trim(), content.trim(), new Date().toISOString(), requestId, requestHash, articleId, parentId, parentId, articleId).first();
  if (!inserted) {
    const race = await c.env.DB.prepare('SELECT id,request_hash FROM comments WHERE request_id=?').bind(requestId).first<{ id: string; request_hash: string }>();
    if (race?.request_hash === requestHash) return c.json({ id: race.id, duplicate: true });
    return c.json({ error: '文章或回覆狀態已變更，請重新載入。' }, 409);
  }
  return c.json({ id }, 201);
});

app.get('/auth/github', async c => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return c.text('GitHub 登入尚未設定完成。', 503);
  const state = randomToken();
  await c.env.DB.prepare('INSERT INTO oauth_states(hash,expires_at) VALUES (?,?)').bind(await sha256(state), nowSeconds() + 600).run();
  setCookie(c, cookieName(c, 'state'), state, { httpOnly: true, secure: !local(c), sameSite: 'Lax', path: '/', maxAge: 600 });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: `${c.env.SERVICE_ORIGIN}/auth/callback`, state }).toString();
  return c.redirect(url.toString());
});
app.get('/auth/callback', async c => {
  c.header('Cache-Control', 'no-store');
  const state = c.req.query('state');
  const code = c.req.query('code');
  const expected = getCookie(c, cookieName(c, 'state'));
  deleteCookie(c, cookieName(c, 'state'), { path: '/', secure: !local(c) });
  if (!state || state.length !== 64 || state !== expected || !code || code.length > 512) return c.text('登入驗證失敗，請重新登入。', 400);
  const used = await c.env.DB.prepare('DELETE FROM oauth_states WHERE hash=? AND expires_at>? RETURNING hash').bind(await sha256(state), nowSeconds()).first();
  if (!used) return c.text('登入已過期，請重新登入。', 400);
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${c.env.SERVICE_ORIGIN}/auth/callback` }), signal: AbortSignal.timeout(10000)
  });
  if (!tokenResponse.ok) return c.text('GitHub 登入暫時無法使用。', 502);
  const access = await tokenResponse.json<{ access_token?: string }>();
  if (!access.access_token) return c.text('GitHub 授權失敗，請重新登入。', 401);
  const userResponse = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${access.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'blog-comments' }, signal: AbortSignal.timeout(10000) });
  if (!userResponse.ok) return c.text('GitHub 身份驗證失敗。', 401);
  const user = await userResponse.json<{ id: number }>();
  if (String(user.id) !== c.env.ADMIN_GITHUB_ID) return c.text('此帳號沒有管理權限。', 403);
  const oldSession = getCookie(c, cookieName(c, 'session'));
  if (oldSession) await c.env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha256(oldSession)).run();
  const session = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions(hash,expires_at) VALUES (?,?)').bind(await sha256(session), nowSeconds() + 28800).run();
  setCookie(c, cookieName(c, 'session'), session, { httpOnly: true, secure: !local(c), sameSite: 'Lax', path: '/', maxAge: 28800 });
  return c.redirect('/admin/');
});
app.use('/api/v1/admin/*', async (c, next) => {
  const session = getCookie(c, cookieName(c, 'session'));
  if (!session || !await c.env.DB.prepare('SELECT hash FROM sessions WHERE hash=? AND expires_at>?').bind(await sha256(session), nowSeconds()).first()) return c.json({ error: '請先登入管理後台。' }, 401);
  await next();
});
app.get('/api/v1/admin/me', c => c.json({ login: 'realRurichan' }));
app.post('/api/v1/admin/logout', async c => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha256(getCookie(c, cookieName(c, 'session'))!)).run();
  deleteCookie(c, cookieName(c, 'session'), { path: '/', secure: !local(c) });
  return c.json({ ok: true });
});
app.get('/api/v1/admin/comments', async c => {
  const status = c.req.query('status') || 'all';
  if (!['all', 'visible', 'hidden', 'deleted'].includes(status)) return c.json({ error: '狀態無效。' }, 400);
  let cursor: [string, string];
  try { cursor = decodeCursor(c.req.query('cursor')); } catch { return c.json({ error: '分頁參數無效。' }, 400); }
  const { results } = await c.env.DB.prepare(`SELECT c.id,c.article_id,c.parent_id,c.author,c.content,c.created_at,c.status,c.source_id,a.title,a.path FROM comments c JOIN articles a ON a.id=c.article_id WHERE (?='all' OR c.status=?) AND (c.created_at,c.id)>(?,?) ORDER BY c.created_at,c.id LIMIT 51`).bind(status, status, ...cursor).all<{ created_at: string; id: string }>();
  return c.json({ comments: results.slice(0, 50), nextCursor: results.length > 50 ? encodeCursor(results[49]) : null });
});
app.patch('/api/v1/admin/comments/:id', async c => {
  let status;
  try { ({ status } = await c.req.json()); } catch { return c.json({ error: '內容格式無效。' }, 400); }
  if (!['visible', 'hidden'].includes(status)) return c.json({ error: '狀態無效。' }, 400);
  const result = await c.env.DB.prepare("UPDATE comments SET status=?,moderated_at=? WHERE id=? AND status!='deleted' RETURNING id").bind(status, new Date().toISOString(), c.req.param('id')).first();
  return result ? c.json({ ok: true }) : c.json({ error: '評論不存在或已刪除。' }, 404);
});
app.delete('/api/v1/admin/comments/:id', async c => {
  const result = await c.env.DB.prepare("UPDATE comments SET status='deleted',author='',content='',moderated_at=? WHERE id=? RETURNING id").bind(new Date().toISOString(), c.req.param('id')).first();
  return result ? c.json({ ok: true }) : c.json({ error: '評論不存在。' }, 404);
});
app.get('/', c => c.redirect('/admin/'));
app.get('*', async c => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: '找不到此端點。' }, 404);
  const response = await c.env.ASSETS.fetch(c.req.raw);
  // c.header() 不作用於直接 return 的原始 Response,必須重建 Response 才能帶上標頭。
  const res = new Response(response.body, response);
  if (c.req.path.endsWith('.js')) res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.headers.set('Cache-Control', c.req.path.startsWith('/admin') ? 'no-store' : 'public, max-age=300');
  return res;
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings) {
    const now = nowSeconds();
    await env.DB.batch(['rate_limits', 'oauth_states', 'sessions'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(now)));
  }
};
