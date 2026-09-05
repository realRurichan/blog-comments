import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { convert } from 'html-to-text';
import { normalizePath } from '../shared/article.mjs';
import { sql } from './manifest.mjs';
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const id = node => String(node?.['@_dsq:id'] ?? node?.['@_id'] ?? '');
const refId = node => typeof node === 'string' ? node : id(node);
const yes = value => value === true || value === 'true' || value === '1';
export function migrate(xml, articles) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entities are not accepted');
  if (XMLValidator.validate(xml) !== true) throw new Error('Malformed XML');
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: false }).parse(xml).disqus;
  if (!parsed) throw new Error('Expected Disqus export');
  const paths = new Map(articles.map(a => [a.path, a]));
  const threads = new Map(array(parsed.thread).map(t => [id(t), t]));
  const rows = array(parsed.post), posts = new Map();
  for (const post of rows) {
    if (!id(post) || posts.has(id(post))) throw new Error('Missing or duplicate Disqus post ID');
    posts.set(id(post), post);
  }
  const excluded = new Set(rows.filter(p => yes(p.isDeleted) || yes(p.isSpam)).map(id));
  const matched = new Map(), visiting = new Set(), unresolved = [], failed = new Set();
  function fail(postId, reason) { if (!failed.has(postId)) unresolved.push({ sourceId: postId, reason }); failed.add(postId); return null; }
  function visit(postId) {
    if (matched.has(postId)) return matched.get(postId);
    if (failed.has(postId) || excluded.has(postId)) return null;
    const post = posts.get(postId);
    if (!post) return null;
    if (visiting.has(postId)) return fail(postId, 'Reply cycle');
    visiting.add(postId);
    const thread = threads.get(refId(post.thread));
    let article;
    for (const value of [thread?.link, ...array(thread?.id)]) {
      if (typeof value !== 'string') continue;
      try { const path = value.startsWith('/') ? value : new URL(value).pathname; article = paths.get(normalizePath(path)); if (article) break; } catch { /* report below */ }
    }
    if (!article) return fail(postId, 'Article path not found in manifest');
    const created = new Date(String(post.createdAt).match(/(?:Z|[+-]\d\d:\d\d)$/) ? post.createdAt : `${post.createdAt}Z`);
    if (Number.isNaN(created.getTime())) return fail(postId, 'Invalid timestamp');
    let parentId = null;
    const parentSource = refId(post.parent);
    if (parentSource && !excluded.has(parentSource)) {
      const parent = visit(parentSource);
      if (!parent) return fail(postId, 'Parent missing or unresolved');
      if (parent.articleId !== article.id) return fail(postId, 'Parent belongs to another article');
      parentId = parent.id;
    }
    const content = convert(String(post.message ?? ''), { wordwrap: false, selectors: [{ selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }, { selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }).trim();
    if (!content) return fail(postId, 'Empty text after HTML conversion');
    const result = { id: `disqus:${postId}`, sourceId: `disqus:${postId}`, articleId: article.id, parentId, author: String(post.author?.name || '訪客'), content, createdAt: created.toISOString() };
    visiting.delete(postId); matched.set(postId, result); return result;
  }
  rows.forEach(post => visit(id(post)));
  return { total: rows.length, excluded: excluded.size, comments: [...matched.values()], unresolved };
}
export function migrationSQL(comments) {
  return comments.map(c => `INSERT INTO comments(id,article_id,parent_id,author,content,created_at,source_id) VALUES (${[c.id,c.articleId,c.parentId,c.author,c.content,c.createdAt,c.sourceId].map(sql).join(',')}) ON CONFLICT(source_id) DO NOTHING;`).join('\n') + '\n';
}
