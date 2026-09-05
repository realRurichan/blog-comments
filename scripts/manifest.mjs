import { normalizePath, articleId } from '../shared/article.mjs';
export const sql = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export function validateManifest(data) {
  if (data.version !== 1 || !Array.isArray(data.articles) || !data.articles.length) throw new Error('Expected nonempty version 1 article manifest');
  const ids = new Set(), paths = new Set();
  for (const article of data.articles) {
    if (typeof article.title !== 'string' || article.path !== normalizePath(article.path) || typeof article.id !== 'string') throw new Error('Invalid article entry');
    if (article.id !== articleId(article.path) && !/^id:[a-zA-Z0-9_-]{1,120}$/.test(article.id)) throw new Error('Invalid article ID');
    if (ids.has(article.id) || paths.has(article.path)) throw new Error('Duplicate article ID or path');
    ids.add(article.id); paths.add(article.path);
  }
  return data.articles;
}
export function articleSQL(articles) {
  const upserts = articles.map(a => `INSERT INTO articles(id,path,title,enabled) VALUES (${sql(a.id)},${sql(a.path)},${sql(a.title)},1) ON CONFLICT(id) DO UPDATE SET path=excluded.path,title=excluded.title,enabled=1;`);
  upserts.push(`UPDATE articles SET enabled=0 WHERE id NOT IN (${articles.map(a => sql(a.id)).join(',')});`);
  return upserts.join('\n') + '\n';
}
