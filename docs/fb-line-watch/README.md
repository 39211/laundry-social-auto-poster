# FB Page → LINE 測試群監看管線（私享家）

> 本目錄備份 2026-09-05 在 Grok Bot 上線的「FB 粉專／Messenger → 單張卡片 → LINE 測試群」監看管線之文件與基線指紋。**本 repo 只放文件與去識別化基線；金鑰、群組 ID、截圖證據一律不進版控。**
>
> This directory backs up the docs and sanitized baselines for the FB Page / Messenger → single-card → LINE test-group watch pipeline that went live on Grok Bot on 2026-09-05. Docs and redacted fingerprints only — no tokens, no group IDs, no screenshot evidence in git.

## 監看目標 / Watch targets

- **FB Page**：私享家 旗艦店 — <https://www.facebook.com/100083194756904/>
  - 偵測粉專**版主新貼文**：展開「查看更多」後取最新一則版主貼文首行（約 80 字元）作為 fingerprint。
  - Detect new **page-owner** posts: fingerprint = first line (~80 chars) of the newest owner post after expanding「查看更多」.
- **Messenger / Page Inbox**：以粉專身分監看私訊。
  - **優先使用 `https://www.facebook.com/messages/`（以 Page 身分操作）**；Business Suite 收件匣（`business.facebook.com/latest/inbox`）可能回 unavailable-content，此時改用 Messages 介面。
  - Prefer `facebook.com/messages` while acting as the Page; the Business Suite inbox may return unavailable-content, in which case Messages is the working surface.
  - fingerprint = thread id/title + 最新 inbound 預覽／時間（或未讀徽章變化 + 收件匣首列 hash）。

## 推送路徑 / Push path

- **LINE bot「小蝦」→ 測試群 only**（group publish；無家族群推送線路 / no family-group track）。
- 圖片公開託管於 public repo **`39211/line-media`**（GitHub raw / Pages），路徑例：`watch-20260905/shoe-sole-one.jpg`。
- LINE push 前必須 **HEAD 檢查**圖片 URL 回 200 且 `Content-Type: image/*`；推送後記錄 LINE API HTTP status。
- Images are hosted publicly on `39211/line-media`; both URLs must HEAD 200 `image/*` before the LINE push, and the LINE HTTP status is recorded after.

## 品質鎖（user-confirmed）/ Locked quality bar

- **一則告警 = 一張完整卡片**：完整展開的文案 + 全部媒體合成同一張圖。
- **絕不**把文字與照片拆成兩張 LINE 圖片（no text/photo split）。
- 裁掉「**加強推廣 / Boost**」列與其他管理員 chrome；不留大片空白、側欄或粉專封面。
- 依**真實主題語意**命名——不得被首行譬喻誤導：鞋底／鞋墊／鞋跟保養文即使以「夜市走一圈…」開頭，**不得標成夜市文**（topic by meaning, not by first-line metaphor）。
- 視窗放不下時，zoom/scroll/compose 成**一張** stitched card 再發布，交付物仍然是一張圖。
- 只讀不回：不按讚、不留言、不 react、不 boost、不送訊息。

## 排程（Grok Bot routines）/ Schedules

| Routine | Cron | 說明 |
| --- | --- | --- |
| Page watch | `*/15 9-21` | 每 15 分鐘（09:00–21:59）輪詢粉專動態，比對 `last_post` 基線 |
| Messenger watch | `*/10 9-21` | 每 10 分鐘（09:00–21:59）輪詢收件匣，比對 `messenger` 基線 |

- 相同 fingerprint → 保持安靜（不 ping 使用者）；`alert_on_new_only: true`。
- Loop-guard：不重複推送相同成功結果；同一步驟連續失敗 2 次即停止並回報。
- Same fingerprint → stay quiet. No identical successful re-push; stop and report after 2 identical step failures.

## 基線檔 / Baselines

- [`baselines/last_post.example.json`](baselines/last_post.example.json) — 粉專貼文指紋快照（2026-09-05 建立，`last_detected` 為鞋底文首行）。
- [`baselines/messenger.example.json`](baselines/messenger.example.json) — Page 收件匣指紋快照（客戶名稱已以 `[customer-N]` 佔位符去識別化）。
- 正式基線（含即時 fingerprint）只存在 bot 主機上；repo 內為 `.example.json` 結構範本。
- Live baselines stay on the bot box; the repo carries sanitized `.example.json` templates only.

## 密鑰邊界 / Secrets boundary

- LINE channel token、group ID、FB 登入態等密鑰**只放在 bot 主機 `~/.config/line/`**，永不 commit。
- 本目錄不得出現任何 token、`.env`、`group_id` 或客戶個資；截圖證據（含單張卡片成品）放 `39211/line-media`，不放本 private repo。
- Secrets (LINE tokens, group IDs, FB session) live only under `~/.config/line/` on the bot box — never committed. Evidence images live on `39211/line-media`, not in this repo.

## 操作技能 / Skill

- Agent 操作手冊：[`/.cursor/skills/fb-page-post-to-line/SKILL.md`](../../.cursor/skills/fb-page-post-to-line/SKILL.md)（偵測、截圖、託管、推送與 PASS 證據定義）。

## 相關連結 / Related

- 本 repo 尚無先前的 fb-line-watcher 研究或 PR（2026-09-05 為首次備份）；後續相關 PR 應在此補鏈。
- 相鄰的 LINE 管線 PR：
  - [#18 Make a LINE click always say where it came from](https://github.com/39211/laundry-social-auto-poster/pull/18)（LINE 點擊來源歸因）
  - [#47 feat(copy): slot-2 two-photo LINE closer from 2026-09-08](https://github.com/39211/laundry-social-auto-poster/pull/47)（LINE 收尾圖文案）
