import { describe, expect, it } from 'vitest';
import { normalizePath, articleId } from '../shared/article.mjs';
import { validateManifest } from './manifest.mjs';
describe('article IDs', () => {
  it('normalizes index and unicode paths', () => expect(normalizePath('/2021/且聽風吟/index.html')).toBe('/2021/且聽風吟/'));
  it('rejects traversal and encoded separators', () => { expect(() => normalizePath('/../x')).toThrow(); expect(() => normalizePath('/%2fx')).toThrow(); });
  it('accepts explicit stable IDs', () => expect(articleId('/x/', 'legacy-1')).toBe('id:legacy-1'));
  it('rejects duplicate manifest records', () => expect(() => validateManifest({ version: 1, articles: [{ id: 'path:/x/', path: '/x/', title: 'x' }, { id: 'path:/x/', path: '/x/', title: 'y' }] })).toThrow());
});
