# blog-comments

自託管的 Hexo 評論服務，使用 Cloudflare Workers + D1。服務提供訪客留言、回覆、分頁、Turnstile 防垃圾，以及 GitHub OAuth 管理後台。

已部署環境、尚待啟用項目與備份方式見 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 本機預覽

```sh
cp .dev.vars.example .dev.vars
pnpm install
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler d1 execute DB --local --file=examples/demo.sql
pnpm dev
```

開啟 <http://localhost:8787/demo/>。本機 Turnstile 可使用 Cloudflare 官方測試金鑰；正式環境必須以 `wrangler secret put` 設定秘密。

## 發布前設定

1. 在 Cloudflare 建立 staging、production D1，填入 `wrangler.jsonc` 中的 database ID。
2. 建立 Turnstile widget，正式環境允許 `blog.rurichan.work` 和 `comments.rurichan.work`；測試環境使用独立 widget 與精確的預覽域名。
3. 建立 GitHub OAuth App，callback URL 為 `https://comments.rurichan.work/auth/callback`。
4. 設定 `TURNSTILE_SECRET_KEY`、`RATE_LIMIT_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` secrets。
5. 寫入文章 manifest：`pnpm articles MANIFEST.json work/articles.sql`，確認後執行 D1 SQL。
6. `pnpm deploy:staging` 通過驗收後，再執行 `pnpm deploy:production`。

部署腳本會拒絕 placeholder、非 HTTPS origin 和測試 site key。資料庫 migration 可重跑；評論匯入使用 `source_id` 冪等。

## Disqus 遷移

```sh
pnpm import:disqus disqus-export.xml MANIFEST.json work/disqus-preview --write-sql
```

預覽會列出文章未匹配、父評論遺失、循環回覆、刪除／垃圾內容與空文字。存在未解決項目時不會產生匯入 SQL，也不會寫入資料庫。

## API

公開端點為 `GET /api/v1/comments?article=...`、`POST /api/v1/comments` 及 `GET /api/v1/config`。管理端點需要 GitHub OAuth session。文章識別碼使用 `path:/year/month/day/title/`；Hexo front matter 的 `comment_id: legacy-1` 會生成 `id:legacy-1`。
