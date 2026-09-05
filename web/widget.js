let turnstilePromise;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => failed(), 15000);
    function failed() { clearTimeout(timer); script.remove(); turnstilePromise = undefined; reject(new Error('驗證服務無法載入，請稍後按「重新驗證」。')); }
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timer); window.turnstile ? resolve(window.turnstile) : failed(); };
    script.onerror = failed;
    document.head.append(script);
  });
  return turnstilePromise;
}
const css = `
:host{display:block;color:#343c3a;font:16px/1.7 system-ui,-apple-system,"Noto Sans TC",sans-serif;--accent:#396b59;--muted:#707b76;--line:#dce3dd;--paper:#f6f8f4;color-scheme:light}
*{box-sizing:border-box}section{margin:36px 0 16px;padding:28px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}
h2{font-size:22px;letter-spacing:.08em;margin:0 0 6px;font-weight:600}p{margin:0 0 16px}.intro,.meta,.note{color:var(--muted);font-size:13px}.intro{margin-bottom:24px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 5px}input,textarea{font:inherit;color:inherit;width:100%;border:1px solid #bdc9c0;background:#fff;border-radius:6px;padding:10px 12px}input{max-width:320px}textarea{resize:vertical;min-height:130px}
input:focus,textarea:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button{font:inherit;font-size:14px;border:1px solid var(--accent);border-radius:6px;padding:8px 15px;cursor:pointer;background:transparent;color:var(--accent)}button.primary{background:var(--accent);color:white}button:disabled{opacity:.5;cursor:wait}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.status{font-size:14px;margin:12px 0;white-space:pre-wrap}.error{color:#9b342d}.replying{padding:8px 12px;background:#e8eee6;border-radius:6px;font-size:14px;margin:16px 0}.replying button{margin-left:12px;padding:1px 8px}
.list{margin-top:28px}.comment{border-top:1px solid var(--line);padding:20px 0}.name{font-weight:600;overflow-wrap:anywhere}.meta{display:block;margin:2px 0 8px}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}.comment button{font-size:12px;padding:3px 12px}.quote{font-size:13px;color:var(--muted);border-left:2px solid #b2c6b5;padding-left:10px;margin:10px 0}.captcha{margin-top:16px;min-height:65px} [hidden]{display:none!important}
@media(max-width:480px){section{padding:18px 12px;margin-top:24px}input{max-width:none}.captcha{overflow-x:auto}h2{font-size:20px}}
`;
export class BlogComments extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${css}</style><section aria-labelledby="heading">
      <h2 id="heading">留下你的想法</h2><p class="intro">文字讓我們相遇。歡迎分享，也請彼此尊重。</p>
      <form><label for="name">暱稱</label><input id="name" name="author" required maxlength="40" autocomplete="nickname" placeholder="如何稱呼你？">
      <div class="replying" hidden><span></span><button type="button" id="cancel">取消回覆</button></div>
      <label for="message">留言</label><textarea id="message" name="content" required maxlength="4000" placeholder="寫下一點想法……"></textarea>
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" tabindex="-1" autocomplete="off"></div>
      <p class="note">留言會立即公開。支援純文字，最多 4,000 字；請勿填寫私人資料。</p>
      <div class="captcha"></div><button id="verify" type="button">重新驗證</button>
      <div class="actions"><button class="primary" type="submit" disabled>發布留言</button><span class="note">無需註冊帳號</span></div>
      <div class="status" id="submit-status" role="status" aria-live="polite"></div></form>
      <div class="list" aria-label="評論列表"></div><div class="status" id="list-status" role="status" aria-live="polite"></div>
      <div class="actions"><button id="retry" type="button" hidden>重新載入評論</button><button id="more" type="button" hidden>載入更多</button></div>
      </section>`;
    const q = s => this.shadowRoot.querySelector(s);
    this.q = q;
    try {
      this.server = new URL(this.getAttribute('server'));
      if (!['https:', 'http:'].includes(this.server.protocol) || (this.server.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(this.server.hostname))) throw new Error();
      this.server = this.server.origin;
      this.article = this.getAttribute('article-id');
      if (!this.article) throw new Error();
    } catch { this.status('list', '評論設定無效。', true); return; }
    q('form').addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    q('form').addEventListener('input', () => { this.requestId = undefined; });
    q('#cancel').onclick = () => this.reply(null);
    q('#verify').onclick = () => this.verify();
    q('#retry').onclick = () => this.load(!!this.cursor);
    q('#more').onclick = () => this.load(true);
    this.load(false);
    this.verify();
  }
  disconnectedCallback() { if (this.widgetId !== undefined) { window.turnstile?.remove(this.widgetId); this.widgetId = undefined; } }
  status(kind, message, error = false) { const el = this.q(`#${kind}-status`); el.textContent = message; el.classList.toggle('error', error); }
  async request(path, options) {
    const response = await fetch(this.server + path, { ...options, credentials: 'omit', signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '評論服務暫時無法使用，請稍後重試。');
    return result;
  }
  async verify() {
    if (this.verifying) return;
    this.verifying = true;
    this.token = '';
    this.q('[type=submit]').disabled = true;
    this.q('#verify').disabled = true;
    try {
      const config = await this.request('/api/v1/config');
      const turnstile = await loadTurnstile();
      if (!this.isConnected) return;
      if (this.widgetId !== undefined) turnstile.remove(this.widgetId);
      this.widgetId = turnstile.render(this.q('.captcha'), {
        sitekey: config.siteKey, action: 'comment', language: 'zh-tw', theme: 'light', size: 'flexible',
        callback: token => { this.token = token; this.q('[type=submit]').disabled = !!this.submitting; },
        'expired-callback': () => { this.token = ''; this.q('[type=submit]').disabled = true; },
        'error-callback': () => { this.token = ''; this.q('[type=submit]').disabled = true; this.status('submit', '驗證無法完成，請按「重新驗證」。輸入內容會保留。', true); }
      });
    } catch (error) { this.status('submit', error.message || '無法載入驗證，請重試。', true); }
    finally { this.verifying = false; this.q('#verify').disabled = false; }
  }
  async load(more) {
    if (this.loading) return;
    this.loading = true;
    this.q('#more').disabled = true;
    this.q('#retry').hidden = true;
    this.status('list', '正在載入評論……');
    try {
      const params = new URLSearchParams({ article: this.article });
      if (more && this.cursor) params.set('cursor', this.cursor);
      const data = await this.request(`/api/v1/comments?${params}`);
      if (!more) this.q('.list').replaceChildren();
      data.comments.forEach(comment => this.renderComment(comment));
      this.cursor = data.nextCursor;
      this.q('#more').hidden = !this.cursor;
      this.status('list', this.q('.list').children.length ? '' : '還沒有留言，來當第一個分享想法的人吧。');
    } catch (error) { this.status('list', error.message || '評論載入失敗，請重試。', true); this.q('#retry').hidden = false; }
    finally { this.loading = false; this.q('#more').disabled = false; }
  }
  renderComment(comment) {
    if (this.shadowRoot.getElementById(`comment-${comment.id}`)) return;
    const entry = document.createElement('article');
    entry.className = 'comment'; entry.id = `comment-${comment.id}`;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = comment.author;
    const time = document.createElement('time'); time.className = 'meta'; time.dateTime = comment.created_at; time.textContent = new Date(comment.created_at).toLocaleString('zh-TW');
    entry.append(name, time);
    if (comment.parent_id) { const quote = document.createElement('div'); quote.className = 'quote'; quote.textContent = `回覆 ${comment.parent_author || '已移除的留言'}`; entry.append(quote); }
    const content = document.createElement('p'); content.className = 'body'; content.textContent = comment.content;
    const reply = document.createElement('button'); reply.type = 'button'; reply.textContent = '回覆'; reply.setAttribute('aria-label', `回覆 ${comment.author}`); reply.onclick = () => this.reply(comment);
    entry.append(content, reply); this.q('.list').append(entry);
  }
  reply(comment) {
    this.parentId = comment?.id || null;
    this.requestId = undefined;
    this.q('.replying').hidden = !comment;
    this.q('.replying span').textContent = comment ? `回覆 ${comment.author}` : '';
    if (comment) this.q('#message').focus();
  }
  async submit() {
    if (this.submitting || !this.token || !this.q('form').reportValidity()) return;
    this.submitting = true;
    const button = this.q('[type=submit]'); button.disabled = true; button.textContent = '發布中……';
    // Freeze fields so successful completion cannot erase edits made during a slow request.
    const fields = [...this.shadowRoot.querySelectorAll('input,textarea,#cancel')]; fields.forEach(el => el.disabled = true);
    this.requestId ||= crypto.randomUUID();
    this.status('submit', '正在發布留言……');
    try {
      await this.request('/api/v1/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articleId: this.article, author: this.q('#name').value, content: this.q('#message').value, parentId: this.parentId || null, requestId: this.requestId, token: this.token, website: this.q('#website').value }) });
      this.q('#message').value = ''; this.requestId = undefined; this.reply(null);
      this.status('submit', '留言已發布，謝謝你的分享。評論按時間排序，可按「載入更多」查看最新留言。');
      this.cursor = null; await this.load(false);
    } catch (error) { this.status('submit', `${error.message || '發布失敗。'}\n輸入內容已保留，重新驗證後可再次提交。`, true); }
    finally { this.submitting = false; fields.forEach(el => el.disabled = false); button.textContent = '發布留言'; this.token = ''; button.disabled = true; if (this.widgetId !== undefined) window.turnstile?.reset(this.widgetId); }
  }
}
if (!customElements.get('blog-comments')) customElements.define('blog-comments', BlogComments);
