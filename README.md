# 私享家洗衣店 Codex Automation 自動發文系統

這個專案是 v1「全用 Codex」版本：Codex Project Automation 每天產生 10 篇 FB/IG 文案，用內建 `$imagegen` 產生 10 張圖片，並由 Node 程式以 dry-run 模式模擬分時段發文。

預設不使用 `OPENAI_API_KEY`、Cloudinary、Supabase、Chrome plugin、Computer Use plugin、Facebook/Instagram plugin。

## 快速開始

```bash
npm install
cp .env.example .env
npm run generate
npm run generate-image-manifest
npm test
```

`.env` 預設保持：

```bash
DRY_RUN=true
TIMEZONE=Asia/Taipei
META_GRAPH_API_VERSION=v25.0
PUBLIC_IMAGE_BASE_URL=https://your-github-username.github.io/laundry-social-auto-poster
```

`DRY_RUN=true` 時不會呼叫 Meta Graph API。
`post-current-slot` 仍會要求 `PUBLIC_IMAGE_BASE_URL` 已設定成真正的 GitHub Pages URL，避免 dry-run 使用不存在的公開圖片網址。

## 每日流程

1. `npm run generate` 建立 `data/content-calendar/YYYY-MM-DD.json`。
2. `npm run generate-image-manifest` 建立 `data/image-prompts/YYYY-MM-DD.json`。
3. 同步建立 `docs/content-calendar/YYYY-MM-DD.json`，供 GitHub Pages 與其他 automation worktree 讀取。
4. Codex Automation 依 manifest 呼叫內建 `image_gen`，把圖片放到 `docs/assets/YYYY-MM-DD/slot-XX.png`。
5. `npm run validate-images` 確認 10 張圖片存在。
6. `npm run publish-pages` 將 `docs/assets`、`docs/content-calendar`、`docs/index.html` commit 並 push 到 GitHub Pages repo。
7. 分時段執行 `npm run post-current-slot`，優先讀 `docs/content-calendar/YYYY-MM-DD.json`，再寫入 `data/posted-log/YYYY-MM-DD.json`。

`publish-pages` 只會 stage/commit/push GitHub Pages 需要的 docs 檔案。它不會加入 `.env`，也會拒絕發布看起來含有 API key 或 Meta token 的文字檔。

## GitHub Pages 圖片 URL

Instagram Content Publishing API 需要公開 HTTPS `image_url`。v1 使用公開 GitHub repo + GitHub Pages：

1. 建立公開 repo：`laundry-social-auto-poster`。
2. 推送專案到 GitHub。
3. 到 repo Settings -> Pages。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，folder 選 `/docs`。
6. 設定 `.env`：

```bash
PUBLIC_IMAGE_BASE_URL=https://your-github-username.github.io/laundry-social-auto-poster
```

圖片本地路徑是 `docs/assets/YYYY-MM-DD/slot-01.png`，公開 URL 會是：

```text
https://your-github-username.github.io/laundry-social-auto-poster/assets/YYYY-MM-DD/slot-01.png
```

每日內容 JSON 的公開 URL 會是：

```text
https://your-github-username.github.io/laundry-social-auto-poster/content-calendar/YYYY-MM-DD.json
```

## Codex Project Automations

建立 3 個 Project Automation，不要用 Thread Automation。

每日內容產生：

```text
每天 Asia/Taipei 06:30
任務：讀取 .agents/skills/daily-automation/SKILL.md，執行 Morning Generation 流程。使用內建 image_gen 產圖，保存到 docs/assets，執行 npm run publish-pages，保持 dry-run。
```

白天發文：

```text
每天 Asia/Taipei 07:30、09:30、11:30、13:30、15:30、17:30、19:30
任務：執行 npm run post-current-slot，保持 dry-run。
```

晚間發文：

```text
每天 Asia/Taipei 21:00、22:00、23:00
任務：執行 npm run post-current-slot，保持 dry-run。
```

## Meta 正式發文設定

正式發文前才填：

```bash
META_ACCESS_TOKEN=
FB_PAGE_ID=
IG_USER_ID=
DRY_RUN=false
VERIFY_PUBLIC_IMAGE_URL=true
```

Facebook 發文使用 `/{page_id}/photos`。Instagram 發文先建立 `/{ig_user_id}/media` container，再呼叫 `/{ig_user_id}/media_publish`。

## 測試

```bash
npm run typecheck
npm test
```

測試包含 slot resolver、GitHub Pages URL builder、dry-run Meta clients、retry/idempotency，以及 dry-run 不呼叫 Meta API 的保護。
也包含 `PUBLIC_IMAGE_BASE_URL` 必填、圖片 URL 不可讀不得寫 success、`.env` 不得被 `publish-pages` commit 的安全檢查。
