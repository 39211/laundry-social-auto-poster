# 私享家曝光作業系統 v1（2026-09-04）

> 老闆一句話的需求：SEO、GA4、FB／IG／YT 穩定發布（圖片、文案、影片）、每 3 天做一輪 GA4＋SEO/AEO/GEO 優化，並把現在主流的曝光方法套進來。
> 這份是總圖。每一格都指向 repo 裡已經存在或這次新增的檔案；沒有檔案的格子就是還沒做，不假裝。

## 一、四層架構

```
資產層   官網 169 個可索引 URL（服務 7、答案 30、知識庫、文章 111、總覽）＋ GBP ＋ 三張制度海報
分發層   IG（主戰場）／FB（同步）／YT Shorts／GBP 貼文／LINE（唯一成交入口，全部帶碼）
量測層   GA4 10 個漏斗事件 → leads ledger｜GSC 曝光與索引｜Meta insights｜YouTube 曝光 CTR｜GBP 評論數
迴圈層   每天：day-audit、nightly-optimize｜每 3 天：optimize-72h（新）｜每週：weekly-review｜Day 0/7/28：索引判定
```

## 二、每一層現在有什麼、這次補了什麼

### 資產層（SEO／AEO／GEO）
| 已有 | 這次補 | 檔案 |
|---|---|---|
| 服務頁、30 篇答案頁、知識庫、價目真表格、LocalBusiness＋Service＋FAQPage schema、llms.txt 一族 | 111 篇貼文→可索引文章（厚度閘門）、`/posts/` 總覽、rss.xml、三層麵包屑、上一則／下一則 | `generatePublicSite.ts` |
| 答案框 `answer-box` 第一段 | **答案框補到 40 字以上**（GEO 2026：可抽取答案塊 40–60 字） | 同上 |
| 首頁「為什麼選私享家」 | 加入老闆確認的事實：**每位客人衣物單獨洗滌**、**洗後檢查不到位再洗一次** | 同上 |
| — | 文章與首頁加「到 Google Maps 留一句評論」入口（AI Overviews 引用評論摘要，評論量與新鮮度是門檻） | 同上 |
| 海報字高公式、主視覺 | 第七節制度海報：價目／收送規定／儲值，帶版本月、參考價聲明、帶碼 QR | `docs-internal/poster-spec.md` |

### 分發層（FB／IG／YT／GBP）
| 頻道 | 穩定發布現況 | 這次補 | 2026 主流做法對照 |
|---|---|---|---|
| IG | 11:30 圖文＋12:00 Reel，頭香帶碼留言，hashtag 三層 cap 12，7 天逐字重複閘 | 問句 h1 貫穿標題／字卡／首句；出處行；slot 1 下一集；不低消收送句 | 排名訊號：總觀看時間＋重播、**私訊分享權重是讚的 3–5 倍**、原創內容多 40–60% 分發、先小池測試再放大、雙向互動加權 → 我們的「傳給他」放 slot 2、頭香回覆、15 秒可重播 |
| FB | 與 IG 同步 | 同上 | 洞察 API 黑箱，維持同步不投產能（架構 v4 已定） |
| YT Shorts | 每日 21:00，標題帶地域字，描述六要素 | 描述第二行＝文章網址 | 標題／描述比 tag 重要；用客人會問的問句開頭 → 已是問句 h1 |
| GBP | 週貼包（人工貼）、評論 4.0／16 | 留評論入口進文章與首頁；制度海報底部加掃碼留評論 | Local Pack：GBP 訊號 ~32%、評論 16–20%；AI 摘要抓評論＋貼文＋網站；**每週 2–5 則評論、24 小時內回覆**；Ask Maps 直接讀 GBP＋網站 |
| LINE | `/go/line.html?source=…` 帶碼轉址，GA4 `line_click` | poster source 碼 | 唯一成交入口不變 |

### 量測層（GA4／GSC）
| 已有 | 用法 |
|---|---|
| `ga4-report`（10 事件→leads ledger，缺資料寫 unmeasured） | 每天 23:10 `Laundry-GA4-Collect` |
| `gsc-search-analytics`、`analyze-gsc`、`gsc-index-inspect` | 每天 23:15 `Laundry-GSC-Collect`；索引判定 Day 0/7/28 |
| `sync-meta-insights`、`review-72h`、`generate-performance-optimization` | 週複盤與 72h 列 |
| 這次補：`scripts/optimize-72h.ps1` | 把上面全部串成一張「決策單」，見第三節 |

## 三、每 3 天一輪（新增，這次的核心交付）

`scripts/optimize-72h.ps1` 每 3 天 23:30 跑（在 GA4／GSC 收集之後），做的事：
1. 同步 Meta insights → 產 72h 列 → 讀 GA4 進 ledger → 讀 GSC 當日檔 → 跑叢集優化建議 → sitemap 稽核。
2. 寫 `output/optimize-72h/<date>.md` 決策單：量測狀態表（任何一源失敗寫 unmeasured，不寫 0）、這一窗滿 72 小時的貼文與數字、五條「旋鈕」空格（IG/FB 文案、Reel、YT、SEO/AEO/GEO、GBP），每格只填一個改動。
3. 人（或戰情室對話）填旋鈕、改、寫優化日誌；三天後同一張表看有沒有動。

註冊：合併後在**主 checkout** 執行 `scripts/register-optimize-72h-task.ps1`（每 3 天 23:30，`Laundry-Optimize-72h`）。不在 worktree 註冊，路徑會死。

每輪固定的 SEO/AEO/GEO 檢查（寫在決策單規則區，不靠記憶）：
- GSC 裡「有曝光沒點擊」的頁：查詢意圖與答案開頭對不上 → 只改那頁答案框。
- crawled-not-indexed 超過 28 天的文章：整併同族，不再堆 URL。
- `daily_article_policy.indexable_article_count` 掉了 → 有人把頁面改薄了。
- 不重送沒改的 URL 給 IndexNow。

## 四、主流曝光方法查證（2026-09-04）與已套用

| 來源說什麼 | 私享家對應 | 狀態 |
|---|---|---|
| Google AI Overviews 對在地查詢主要引用 GBP 資料與評論摘要；評論量、新鮮度、回覆率決定被不被引用 | 留評論入口進站、海報掃碼留評論、每週 2–5 則目標進 72h 決策單 | 入口已上；評論要老闆門市開口 |
| 內容結構：每段開頭直接答、問句標題、表格與清單、FAQ schema、保持更新 | 文章頁骨架＋問句 h1＋FAQPage＋每日新增 | 已上 |
| GEO：40–60 字答案塊、實體名稱在官網／GBP／各平台一致、7–14 天內容新鮮度 | 答案框補到 40 字；NAP 由 business-profile 單一來源輸出；每日文章 | 已上 |
| Perplexity／ChatGPT 看多來源一致性（論壇、影片、評論、官網同一套說法） | 台灣對應是 Dcard／PTT／Threads；目前只有 FB/IG/YT；**Threads 是缺口**（一塊印在用） | 未做，列 P2 |
| IG 2026：觀看時間＋重播、私訊分享 3–5 倍權重、原創內容加分、先小池測試 | 15 秒一鏡到底可重播；slot 2「傳給他」；門市實拍非轉貼 | 已符合；留意 AI 生圖被判非原創的風險（已有真門市場景 DNA 規則） |
| YT Shorts：標題描述比 tag 重要；用客人的問句開頭 | 問句 h1＝標題；描述帶文章網址 | 已上 |
| GBP：完整描述、10–15 個服務項目、15–20 題 Q&A、50 張以上照片、每週 2–3 篇貼文 | 週貼包已有；服務項目與照片數量要老闆帳號操作 | 部分 |

## 五、老闆要做的（全部加起來一週 15 分鐘）
1. 每週一支 45–60 秒手機口播（影片規劃 B 線），題目由 72h 決策單給。
2. 門市交件時開口請客人掃碼留評論；每週看一次評論數。
3. 三天一次看決策單 5 個空格，同意就打勾。

## 六、不做的事（寫下來才不會被拉回去）
- 不學洗楽把價目做成圖片、不寫沒出處的百分比、不寫保證。
- 不做動畫講解影片、不做每天老闆對鏡頭。
- 不為湊 URL 數新增薄頁；閘門會自動退回 noindex。

## 來源
- Stackmatix, Google AI Overviews Impact on SEO 2026 — https://www.stackmatix.com/blog/google-ai-overviews-impact-seo-2026
- Nick Throlson, Google AI Overviews: How Small Businesses Get Cited in 2026 — https://nickthrolson.com/google-ai-overviews-small-business/
- Ideaforge Studios, Get Cited in Google AI Overviews — https://ideaforgestudios.com/2026/07/14/how-to-get-your-small-business-cited-in-google-ai-overviews-not-just-ranked/
- WRITER, GEO, AEO, and SEO in 2026 — https://writer.com/blog/geo-aeo-optimization/
- SEOTuners, GEO Best Practices 2026 — https://seotuners.com/blog/generative-engine-optimization/generative-engine-optimization-best-practices/
- ZipTie, Optimize Content for Perplexity 2026 — https://ziptie.dev/blog/how-to-optimize-content-for-perplexity-ai/
- Dataslayer, Instagram Algorithm 2026 — https://www.dataslayer.ai/blog/instagram-algorithm-2025-complete-guide-for-marketers
- Kallkan Media, Instagram Reels Algorithm 2026 — https://kallkanmedia.com/blog/en/instagram-reels-algorithm-2026-ranking-signals.html
- Hibu, YouTube Shorts for Local Businesses — https://hibu.com/blog/marketing-tips/the-ins-and-outs-of-youtube-shorts-for-local-businesses
- TechWyse, The 2026 YouTube Shift — https://www.techwyse.com/blog/video-marketing/youtube-marketing-shift-for-business-2026
- Outpace SEO, Local SEO & GBP Guide 2026 — https://outpaceseo.com/article/local-seo-gbp/
- Gravitas Vision, 2026 GBP Playbook — https://www.gravitasvision.com/post/the-2026-google-business-profile-playbook-beyond-basic-listings
- Chris Brannan, GBP in 2026 (Ask Maps) — https://cwbrannan.com/blog/google-business-profile-2026
