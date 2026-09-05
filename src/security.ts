import type { Context } from 'hono';
import type { AppEnv } from './types';

export const sha256 = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
function hex(buffer: ArrayBuffer) { return Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join(''); }
export async function ipHash(secret: string, ip: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
}
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export function local(c: Context<AppEnv>) { return c.env.ENVIRONMENT === 'local' && ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname); }
export function cookieName(c: Context<AppEnv>, kind: string) { return `${local(c) ? '' : '__Host-'}bc_${kind}`; }
export function origins(c: Context<AppEnv>) { return c.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean); }
export async function consumeLimit(db: D1Database, key: string, expires: number, max: number) {
  const row = await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, expires).first<{ count: number }>();
  return !!row && row.count <= max;
}
export function encodeCursor(row: { created_at: string; id: string }) { return btoa(JSON.stringify([row.created_at, row.id])); }
export function decodeCursor(value?: string): [string, string] {
  if (!value) return ['', ''];
  if (value.length > 400) throw new Error('Invalid cursor');
  const result = JSON.parse(atob(value));
  if (!Array.isArray(result) || result.length !== 2 || typeof result[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(result[0]) || typeof result[1] !== 'string' || result[1].length > 100) throw new Error('Invalid cursor');
  return result as [string, string];
}
