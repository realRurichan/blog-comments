# Cloudflare 部署狀態

2026-09-05：已透過 Cloudflare 插件部署。沒有新增付費方案。

| 環境 | 地址 | D1 |
|---|---|---|
| 正式 | https://comments.rurichan.work | blog-comments-production（APAC） |
| 測試 | https://blog-comments-staging.rurichan.workers.dev/demo/ | blog-comments-staging（APAC） |

兩環境各自使用 Turnstile widget、D1 與限流秘密。秘密只保存在 Cloudflare Worker secret bindings。每天 03:17 UTC 清除過期限流紀錄、登入狀態及 session。

本次使用 `pnpm build:api` 將小型前端資源與 Worker 一同打包，經 multipart upload API 上傳；一般 CLI 重新部署仍可使用 `pnpm deploy:staging` / `pnpm deploy:production` 與原生 ASSETS binding。部署時保留既有秘密。

## 正式啟用

1. 正式 GitHub OAuth App「Ruri Blog Comments」已設定，callback 為 `https://comments.rurichan.work/auth/callback`。`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 均存入 Worker secrets，已實測登入。僅使用 GitHub 公開資料；管理員固定 GitHub user ID 為 `84240213`。測試環境尚未設定獨立 OAuth App。
2. Disqus 匯出已完成預覽與核對：10 個討論串、0 則留言，無需執行留言匯入。詳見 [MIGRATION.md](MIGRATION.md)。
3. 正式環境 `COMMENTS_ENABLED` 已設為 `true` 並部署。博客 `theme_config.blog_comments.enabled` 已設為 `true`，正式分支發布提交為 `1372298da6fddcf45dba9044dbe00a837ebb5c25`。
4. 中國大陸直連仍需實際網絡驗收。本次執行環境經由 NRT Cloudflare 節點成功訪問，不能作為中國大陸直連驗收。

正式管理後台為 https://comments.rurichan.work/admin/ 。若連通性不符合需求，可依下方方式回退博客設定，保留 D1 內的新留言。

## 文章同步

Journal 主題建置會產生 `public/comments-manifest.json`。每次新增文章或修改固定 ID 後，先產生並核對 SQL，再套用：

```sh
pnpm articles /path/to/blog/public/comments-manifest.json work/articles.sql
pnpm exec wrangler d1 execute DB --env production --remote --file work/articles.sql
```

## 備份與回復

遷移前匯出正式資料庫，檔案放在 git 忽略的 `work/`，不要上傳公開 repo：

```sh
pnpm exec wrangler d1 export DB --env production --remote --output work/backup.sql
```

需要回復時，先把備份匯入一個新的 D1 資料庫並核對文章／評論數，再更新對應環境的 database ID、重新部署。保留原資料庫，避免覆蓋尚未備份的新留言。僅回退網站接入時，將博客新評論開關設為 false 即可恢復 Disqus；不要刪除 D1。

## 已完成驗證

- 13 個自動化測試通過（包含真正的本機 D1 API 測試及 gzip 匯出讀取）。
- 測試站瀏覽器實測 Turnstile 自動成功、留言發布及純文字顯示。
- 正式 Worker 設有寫入開關；未登入不能讀取或修改管理 API。
