import { describe, expect, it } from 'vitest';
import { migrate } from './disqus.mjs';
const xml = `<disqus><thread id="t"><id>t</id><link>https://blog.rurichan.work/a/</link></thread><post id="p1"><id>p1</id><thread>t</thread><createdAt>2024-01-01T00:00:00Z</createdAt><author><name>A</name></author><message><![CDATA[<b>Hello</b>]]></message></post><post id="p2"><id>p2</id><thread>t</thread><parent>p1</parent><createdAt>2024-01-01T00:01:00Z</createdAt><author><name>B</name></author><message>Reply</message></post></disqus>`;
describe('Disqus migration preview', () => {
  it('maps replies and strips markup', () => { const result = migrate(xml, [{ id: 'path:/a/', path: '/a/', title: 'A' }]); expect(result.comments).toHaveLength(2); expect(result.comments[0].content).toBe('Hello'); expect(result.comments[1].parentId).toBe('disqus:p1'); });
  it('rejects DTDs', () => expect(() => migrate('<!DOCTYPE x><disqus/>', [])).toThrow());
});
