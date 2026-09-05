const q = selector => document.querySelector(selector);
let cursor, loading = false;
const labels = { visible: '公開', hidden: '已隱藏', deleted: '已刪除' };
async function api(path, options) {
  const response = await fetch('/api/v1/admin/' + path, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (response.status === 401) { q('#dashboard').hidden = true; q('#login').hidden = false; }
  if (!response.ok) throw new Error(data.error || '操作失敗，請重試。');
  return data;
}
function status(message) { q('#status').textContent = message; }
function render(comment) {
  const item = document.createElement('article'); item.className = 'comment';
  const title = document.createElement('h2'); title.textContent = comment.title;
  const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = `${comment.author || '已刪除'} · ${new Date(comment.created_at).toLocaleString('zh-TW')} · ${labels[comment.status]}${comment.source_id ? ' · Disqus 匯入' : ''}`;
  const path = document.createElement('p'); path.className = 'meta'; path.textContent = comment.path;
  const content = document.createElement('p'); content.className = 'content'; content.textContent = comment.content || '內容已刪除。';
  const actions = document.createElement('div'); actions.className = 'actions';
  if (comment.status !== 'deleted') {
    for (const [label, method, value] of [[comment.status === 'hidden' ? '恢復公開' : '隱藏', 'PATCH', comment.status === 'hidden' ? 'visible' : 'hidden'], ['永久刪除內容', 'DELETE', null]]) {
      const button = document.createElement('button'); button.textContent = label;
      if (method === 'DELETE') button.className = 'danger';
      button.onclick = async () => {
        if (method === 'DELETE' && !confirm('確定永久刪除此評論內容？回覆會保留，但原內容無法恢復。')) return;
        button.disabled = true;
        try { await api(`comments/${encodeURIComponent(comment.id)}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value ? { status: value } : {}) }); await load(false); status('評論狀態已更新。'); }
        catch (error) { status(error.message); }
        finally { button.disabled = false; }
      };
      actions.append(button);
    }
  }
  item.append(title, meta, path, content, actions); q('#list').append(item);
}
async function load(more) {
  if (loading) return;
  loading = true;
  q('#more').disabled = true; q('#filter').disabled = true; status('正在載入……');
  try {
    const params = new URLSearchParams({ status: q('#filter').value });
    if (more && cursor) params.set('cursor', cursor);
    const data = await api('comments?' + params);
    if (!more) q('#list').replaceChildren();
    data.comments.forEach(render); cursor = data.nextCursor;
    q('#more').hidden = !cursor;
    status(q('#list').children.length ? '' : '目前沒有符合條件的評論。');
  } catch (error) { status(error.message); }
  finally { loading = false; q('#more').disabled = false; q('#filter').disabled = false; }
}
q('#more').onclick = () => load(true);
q('#refresh').onclick = () => load(false);
q('#filter').onchange = () => load(false);
q('#logout').onclick = async () => { try { await api('logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.reload(); } catch (error) { status(error.message); } };
api('me').then(() => { q('#login').hidden = true; q('#dashboard').hidden = false; load(false); }).catch(error => status(error.message));
