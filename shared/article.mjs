/** Canonical paths are decoded once, NFC normalized, and always slash-terminated. */
export function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2000) throw new Error('Invalid article path');
  const raw = value.split(/[?#]/, 1)[0];
  // Encoded separators are not equivalent to path separators.
  if (/%2f|%5c/i.test(raw)) throw new Error('Encoded separator');
  const path = decodeURIComponent(raw).normalize('NFC');
  if (/[\u0000-\u001f\u007f\\]/.test(path) || path.split('/').some(x => x === '.' || x === '..')) throw new Error('Invalid article path');
  return path.replace(/\/+/g, '/').replace(/\/index\.html$/, '/').replace(/\/*$/, '/');
}
export function articleId(path, explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    if (typeof explicit !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(explicit)) throw new Error('comment_id must contain 1–120 ASCII letters, digits, underscores or hyphens');
    return `id:${explicit}`;
  }
  return `path:${normalizePath(path)}`;
}
