# AEO325-B-r3 交付報告（目前結果）

STATUS| DONE
BASE| 766ada1c
IMPLEMENTATION_HEAD| dd52973
BRANCH| feat/aeo325-guardrail
PR| https://github.com/39211/laundry-social-auto-poster/pull/206

r3 的結果取代下方保留的 B-r2 歷史紀錄；B-r2 的 PARTIAL/hash-lock 結論已由本輪移除永久 URL hash 鎖的修正取代。

## Item 1 — 全文字掃描與目錄走訪

- 掃描器只略過契約列出的二進位副檔名，副檔名不分大小寫；其餘輸出均以文字掃描。
- HTML、JSON、JSONL、XML、TXT、MD、WEBMANIFEST 維持裸 slug 比對；其他文字只比對 slug.html 前置字元邊界或 /slug 後接 /、引號、問號、井字號、字串結尾這兩類 URL 形狀。
- 目錄以 stat 判斷並跟進 junction/symlink，使用 realpath 集合防止循環；僅下列兩個既有 slug 豁免仍保留：down-vest-cleaning、gore-tex-jacket-cleaning。

## Item 2 — 走訪層反例與突變自證

- 新增 10 個臨時 docs 樹案例：JS、CSS、SVG、HTM、無副檔名、webmanifest 洩漏；PNG 二進位黑名單；只有裸 slug 的 CSS class；豁免 slug 的 JS URL；Windows junction 與回環。
- TDD 紅測先新增案例後執行：21 passed / 6 failed；失敗涵蓋 JS、CSS、SVG、HTM、無副檔名與 junction。webmanifest 在原掃描器下已被讀取。
- 指定的 production mutation ①暫時只讀 .html、②走訪暫時 return []，各自 27 tests 中 7 failed；復原後各自 27/27 passed。junction 與回環案例在本機均建立成功，未 skip。

## Item 3 — 移除永久 URL 集合 hash 鎖

- public-url-baseline.json 已移除 sitemap、AI sitemap、RSS 三組 count/SHA 欄位，保留 source_commit 與原有兩個 pre_existing_slugs。
- Guardrail 測試改為確認三個 URL 集合沒有非豁免 AEO325 slug，並驗證六個目標 URL 的預期存在/缺席；主 sitemap 有五個目標，AI sitemap 有四個基線目標，services/down-jacket-cleaning 不在 sitemap。
- PageCopy 保留 lastmod 斷言並移除整體 URL 集合/count 比對。永久 hash 鎖不能留下：日更會把最新貼文加入 sitemap 的最新 30 篇與 RSS，固定 hash 會在正常內容更新後讓 CI 變紅；本輪「未新增網址」只需作為一次性證據。

## Item 4 — 三頁修正與 docs 同步

- 白鞋服務頁的 #geo-entity 店家卡放回 section.section.surface 雙欄容器，另一欄放「怎麼詢問」新段落。
- 精品包服務頁依 766ada1c 基底逐字補回「門市與收送」article/card，位於三段新文案之後、對應服務之前。
- 白鞋泛黃指南兩個 white-shoe-cleaning.html#service 節點的 description，均與白鞋服務頁同一節點的新 description 完全一致；JSON-LD 可解析。
- 三組 docs 與 seo-overrides 檔案 SHA-256 相同；PageCopy 新增結構與店家資訊斷言。暫時移除精品包門市卡時目標測試 1 failed，還原後 PageCopy 全檔 45/45 passed。

## Item 5 — 基底 marker 數量檢查

- 以 D:\AI-Lanes-work\_tmp\aeob\extract_aeo325_base_markers.py 從 766ada1c 程式重抽六頁 fixture，新增 link rel=alternate 數量與 inline gtag('config' 計數；六頁的 alternate 數量維持基底值（白鞋服務 7，其餘各 6），inline config 各 1。
- PageCopy 斷言逐頁核對 alternate 數量，並要求 inline gtag config 存在。

## Item 6 — 驗證結果

- npm run typecheck：PASS。
- npx vitest run test/aeo325Guardrail.test.ts test/aeo325PageCopy.test.ts：72 passed / 0 failed / 0 skipped。
- 全套 npx vitest run --maxWorkers=4（使用 CI placeholder env PUBLIC_SITE_BASE_URL=https://example.invalid、PUBLIC_IMAGE_BASE_URL=https://example.invalid）：1709 passed / 1 failed / 19 skipped。唯一失敗是既有 test/publicSite.test.ts:2965 缺少 2026-09-15-0 calendar slot；Qinghai timeout 測試獨跑通過。
- 三頁 docs/override 位元相同；未改 scripts、CI、src/generatePublicSite.ts、approvals.json 或 docs-internal/aeo325；沒有新增網址。

## Item 7 — 推送與 PR

- feat/aeo325-guardrail 已推送；PR #206 內文已加入 r3 摘要並讀回確認；PR 維持 OPEN / Draft，base 為 fix/reel-v3-two-reference-images，未 merge、部署或呼叫 IndexNow/GSC。
- 本輪未由 Codex 自行派 Opus 或其他外部席位；如需獨立複審，交由 Claude commander 依其授權路由。PR 保持 Draft，供後續複審。

## 37f617f6..HEAD 逐檔摘要

依 git diff --stat 37f617f6..HEAD 與檔名讀回，以下逐檔說明本輪修改的 14 個檔案。

| 檔案 | 一句話說明 |
|---|---|
| PROGRESS.md | 記錄 B-r3 開工卡、每項進度、驗證數字與交付 checkpoint。 |
| REPORT.md | 加入本節作為目前 r3 報告並保留 B-r2 歷史。 |
| PAYLOAD.md | 以 r3 狀態、七項交付結果與最終測試數字取代 B-r2 payload。 |
| config/aeo325/public-url-baseline.json | 移除三份動態 URL 清單的 count/hash 鎖，保留來源 commit 與兩項既有豁免。 |
| docs/guides/white-shoe-yellowing.html | 同步兩個 Service description 到白鞋服務頁的新導言摘要。 |
| docs/services/luxury-bag-cleaning.html | 同步補回的「門市與收送」卡片。 |
| docs/services/white-shoe-cleaning.html | 同步 #geo-entity 卡片回到原有雙欄容器的結構修正。 |
| seo-overrides/guides/white-shoe-yellowing.html | 同步兩個 white-shoe-cleaning Service description。 |
| seo-overrides/services/luxury-bag-cleaning.html | 從基底補回「門市與收送」卡片。 |
| seo-overrides/services/white-shoe-cleaning.html | 將 #geo-entity 店家卡與「怎麼詢問」放回雙欄 section。 |
| src/aeo325Guardrail.ts | 對非黑名單文字檔掃描 URL 形狀並以 stat/realpath 安全走訪目錄。 |
| test/aeo325Guardrail.test.ts | 新增走訪層反例、slug 集合斷言並移除 sitemap/feed 固定 hash 測試。 |
| test/aeo325PageCopy.test.ts | 驗證頁面結構、門市資訊、marker 數量與固定 lastmod，移除全 URL 集合比對。 |
| test/fixtures/aeo325/base-page-markers.json | 記錄由基底重抽的 alternate 與 inline gtag config 數量。 |

## 驗收摘要

ITEM| 1 | DONE | 二進位黑名單、URL 形狀規則、stat/realpath 走訪
ITEM| 2 | DONE | 走訪層反例 10 條；先紅後綠；兩個指定突變皆紅
ITEM| 3 | DONE | 移除永久 URL hash 鎖，改以 slug 與受管 URL 預期斷言
ITEM| 4 | DONE | 三頁修正 3/3、docs 同步、新增頁面斷言
ITEM| 5 | DONE | 六頁 alternate 數量與 inline gtag config marker 補強
ITEM| 6 | DONE | typecheck 通過；指定兩檔 72/72；全套唯一既有失敗 1
ITEM| 7 | DONE | 推送分支、更新並讀回 Draft PR 內文
TESTS| passed=1709 failed=1 skipped=19
UNSURE| 無

--- B-r2 歷史報告（保留原文；其 PARTIAL/hash-lock 結論已由上方 r3 結果取代）---
# AEO325-B-r2 Report

STATUS| PARTIAL
BASE| 766ada1c
BRANCH| feat/aeo325-guardrail
PR| https://github.com/39211/laundry-social-auto-poster/pull/206

## Item 0 — 還原與拆 overlay

- 六份目標 docs 頁與兩份 sitemap 先還原為 `766ada1c`，commit `66e7f4f9`。
- 從 `src/generatePublicSite.ts` 移除 managed page copy 型別、文案資料、HTML builder、root 開關與 sitemap lastmod 參數/分支；保留 guardrail 載入/檢查、sitemap 過濾掛鉤與僅供 guardrail 使用的 `SOURCE_PROJECT_ROOT`。
- `public-url-baseline.json` 改為 slug 級 `pre_existing_slugs`，只允許 `down-vest-cleaning`、`gore-tex-jacket-cleaning`，並列理由。移除路徑/次數鎖定；兩筆在 `approvals.json` 仍為 `approved=false`。
- TDD red：`npx vitest run test/aeo325Guardrail.test.ts -t "allows only the two legacy slugs anywhere"` 為 1 failed / 16 skipped；實作後完整 guardrail suite 17 passed / 0 failed / 0 skipped。
- 開工 baseline：`npx vitest run test/publicSite.test.ts -t "keeps checked-in public feeds"`；未設必要 env 的初跑在模組載入中止。設 `PUBLIC_SITE_BASE_URL`、`PUBLIC_IMAGE_BASE_URL` 為 `https://sixiangjialaundry.com` 後，1 failed / 48 skipped。唯一失敗是 `test/publicSite.test.ts:2965`：`2026-09-15-0: expected undefined to be defined`。

## Item 1 — Base marker fixture

- `test/fixtures/aeo325/base-page-markers.json` 由程式從 `git show 766ada1c:seo-overrides/<page>` 抽取六頁 × 六個去重集合：meta name、meta property、link rel、JSON-LD `@type`、section/aside id、script src。
- SHA-256 prefix：`F4A7AD3088CD5856`。
- 可重跑的 PowerShell/Node 指令：

```powershell
$src = @'
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const pages = ['services/white-shoe-cleaning.html','guides/white-shoe-yellowing.html','services/luxury-bag-cleaning.html','guides/luxury-bag-mold.html','services/down-jacket-cleaning.html','guides/down-jacket-cleaning.html'];
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : undefined;
}
function tags(html, name) { return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(m => m[0]); }
function collectTypes(value, out) {
  if (Array.isArray(value)) for (const item of value) collectTypes(item, out);
  else if (value && typeof value === 'object') {
    const t = value['@type'];
    if (typeof t === 'string') out.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
    for (const child of Object.values(value)) collectTypes(child, out);
  }
}
const pagesOut = Object.fromEntries(pages.map(page => {
  const html = execFileSync('git', ['show', `766ada1c:seo-overrides/${page}`], { encoding: 'utf8' });
  const metas = tags(html, 'meta'), links = tags(html, 'link'), scripts = tags(html, 'script'), types = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    if (attr(`<script ${m[1] ?? ''}>`, 'type')?.toLowerCase() === 'application/ld+json') collectTypes(JSON.parse(m[2] ?? '{}'), types);
  const unique = values => [...new Set(values.filter(Boolean))].sort();
  return [page, {
    meta_names: unique(metas.map(t => attr(t, 'name'))),
    meta_properties: unique(metas.map(t => attr(t, 'property'))),
    link_rels: unique(links.map(t => attr(t, 'rel'))),
    jsonld_types: unique([...types]),
    section_aside_ids: unique(['section','aside'].flatMap(n => tags(html, n).map(t => attr(t, 'id')))),
    script_srcs: unique(scripts.map(t => attr(t, 'src')))
  }];
}));
const file = join(process.cwd(), 'test/fixtures/aeo325/base-page-markers.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ source_commit: '766ada1c', pages: pagesOut }, null, 2) + '\n', 'utf8');
'@
$src | node -
```

## Item 2 — Page-copy regression tests

- `test/aeo325PageCopy.test.ts` 有 43 項：JSON-LD parse、r3 文案及順序、FAQ 三方逐字一致、marker superset、禁詞/天數、docs 與 override bytes、dateModified/hero time、sitemap lastmod/URL set。
- 先紅證據：基底共 42 項時為 28 failed / 14 passed，涵蓋舊 lead/FAQ/sections、四頁 HowTo、description/date 等。補完整六頁與 sitemap 條件後 43/43 PASS。
- Production mutation：只把 `seo-overrides/services/white-shoe-cleaning.html` FAQ 第三答的「7」改成「8」，不動 docs/JSON-LD；測試對 FAQ 三方一致 (c) 和 docs/override bytes (f) 報紅。還原後該頁 7/7 PASS，六頁 docs/override byte equality PASS。
- 禁詞只掃本輪替換文案與 page-owned schema；依契約排除保留的共享 DryCleaningOrLaundry/Place/Offer 節點、`#index-gap-rail`、`#convert`、`#geo-entity`、店家資料與服務交叉連結區塊。

## Item 3 — 六頁原位改稿

| 頁面 | 修改/保留 |
|---|---|
| `services/white-shoe-cleaning` | 依「白鞋清潔服務」更新 lead、文案 section、metadata、FAQ/FAQPage、自有 schema；保留 `#geo-entity` aside。 |
| `guides/white-shoe-yellowing` | 依「白鞋泛黃指南」更新 lead、`#aeo-u06` answer-box、sections、FAQ/FAQPage；保留交叉連結；移除 HowTo。 |
| `services/luxury-bag-cleaning` | 依「精品包清潔服務」更新 lead、sections、metadata、FAQ/FAQPage；移除 HowTo。 |
| `guides/luxury-bag-mold` | 依「精品包發霉指南」更新 lead、sections、metadata、FAQ/FAQPage；移除 HowTo。 |
| `services/down-jacket-cleaning` | 更新羽絨文案、metadata、FAQ/FAQPage；canonical 仍指指南，保留 `#consolidated-notice` 與相關服務區。 |
| `guides/down-jacket-cleaning` | 更新羽絨文案、metadata、FAQ/FAQPage；保留 `#down-price-split` 和 canonical；移除 HowTo。 |

六份 docs 頁逐頁從對應 seo-overrides 同步，bytes 相同；每頁測試 7/7 PASS。刪除 HowTo/HowToStep/HowToSupply 的四頁為白鞋泛黃指南、精品包服務、精品包發霉指南、羽絨指南。

## Item 4 — Sitemap lastmod（PARTIAL）

- 主 sitemap 的五個可索引目標 lastmod 均為 `2026-10-18`；羽絨服務頁不在 sitemap。
- AI sitemap 基線只有四個目標：白鞋服務、白鞋指南、精品包發霉指南、羽絨指南；四個 lastmod 已改為 `2026-10-18`。`/services/luxury-bag-cleaning.html` 原本缺席。
- 未新增缺席 URL，維持「URL 集合 hash 不變」硬性限制；Item 4 和總狀態保持 PARTIAL。測試比對兩 sitemap 既有目標集合與 lastmod。

## Item 5 — 驗證

- `npm run typecheck`: PASS。
- Guardrail：17 passed / 0 failed / 0 skipped；Page-copy：43 passed / 0 failed / 0 skipped。
- 全套 `npx vitest run --reporter=dot --silent --testTimeout=15000`，兩個 `PUBLIC_*_URL` env 均為 `https://sixiangjialaundry.com`：1697 passed / 1 failed / 19 skipped（1717 total）。唯一失敗仍是開工 baseline `test/publicSite.test.ts:2965` 的 `2026-09-15-0: expected undefined to be defined`。
- 以 `766ada1c` 為基線比較 docs 665 個文字檔，沒有新 325 slug；兩個 legacy slug 各 22 次、分布六檔，位置與次數均同基線。
- URL sets/hashes 不變：sitemap 176 / `f0bf667b6f420a6256933e8aa77afe4a5233df10499c420f13f80cecf48eb623`；AI sitemap 619 / `63bc7ae57a8977f486c5a36d95ca2e38c36804fb863ee7670e1910934c5fdffd`；RSS 216 / `5dd2215c158fa582fe25586f2744110868f72d8840db44035f7e6c1fcdf3d2bd`。
- 未在根目錄跑 `npm run generate-public-site`；未改 `docs-internal/aeo325/`、日更/feature reel/其他白名單頁、CI 或 scripts。

## 基底比較檔案逐檔說明

`git diff --stat 766ada1c..HEAD` 視角中，七個 docs-internal 檔案在任務開始前的 prep commit `852fc5f3` 已加入，本輪未修改。

| 檔案 | 說明 |
|---|---|
| `PROGRESS.md` | 本任務的狀態和驗收 checkpoint。 |
| `REPORT.md` | 驗證證據與逐檔差異說明。 |
| `config/aeo325/approvals.json` | 原清單 325 筆保持未核准。 |
| `config/aeo325/items.json` | 任務開始前已有的 325 項 catalog，本輪未改。 |
| `config/aeo325/public-url-baseline.json` | 列出兩個理由化 legacy slug 豁免。 |
| `docs-internal/aeo325/exec-guide-revision.md` | 起點 prep 版本，本輪未改。 |
| `docs-internal/aeo325/final-down-jacket.md` | 起點 r3 羽絨文案，本輪未改。 |
| `docs-internal/aeo325/final-luxury-bag.md` | 起點 r3 精品包文案，本輪未改。 |
| `docs-internal/aeo325/final-r2-to-r3.diff` | 起點差異說明，本輪未改。 |
| `docs-internal/aeo325/final-white-shoe.md` | 起點 r3 白鞋文案，本輪未改。 |
| `docs-internal/aeo325/handoff-B.md` | 起點交接文件，本輪未改。 |
| `docs-internal/aeo325/owner-facts.md` | 起點事實正本，本輪未改。 |
| `docs/guides/down-jacket-cleaning.html` | 同步羽絨指南稿至 docs。 |
| `docs/guides/luxury-bag-mold.html` | 同步精品包指南稿至 docs。 |
| `docs/guides/white-shoe-yellowing.html` | 同步白鞋指南稿至 docs。 |
| `docs/services/down-jacket-cleaning.html` | 同步羽絨服務稿至 docs。 |
| `docs/services/luxury-bag-cleaning.html` | 同步精品包服務稿至 docs。 |
| `docs/services/white-shoe-cleaning.html` | 同步白鞋服務稿至 docs。 |
| `docs/sitemap.xml` | 更新五個索引目標 lastmod；URL set 不變。 |
| `docs/ai-sitemap.xml` | 更新四個既有目標 lastmod；不新增 URL。 |
| `seo-overrides/guides/down-jacket-cleaning.html` | 原位更新羽絨指南 override。 |
| `seo-overrides/guides/luxury-bag-mold.html` | 原位更新精品包指南 override。 |
| `seo-overrides/guides/white-shoe-yellowing.html` | 原位更新白鞋指南 override。 |
| `seo-overrides/services/down-jacket-cleaning.html` | 原位更新羽絨服務 override。 |
| `seo-overrides/services/luxury-bag-cleaning.html` | 原位更新精品包服務 override。 |
| `seo-overrides/services/white-shoe-cleaning.html` | 原位更新白鞋服務 override。 |
| `src/aeo325Guardrail.ts` | 加入未核准 slug 門禁及兩個 legacy 豁免。 |
| `src/generatePublicSite.ts` | 移除 overlay，保留 guardrail/filter 掛鉤。 |
| `test/aeo325Guardrail.test.ts` | 驗證 legacy slug 全域豁免及其餘 slug 阻擋。 |
| `test/aeo325PageCopy.test.ts` | 43 項頁面文案/schema/metadata/sitemap 回歸測試。 |
| `test/fixtures/aeo325/base-page-markers.json` | 六頁基底結構標記集合。 |

## Item 6–7

- Item 6：commit `8196fb1f` 已 push；`gh pr edit 206 --body-file ...` 更新 Draft PR 內文。最終報告 checkpoint 也已 push，之後以 `git ls-remote` 和 PR API readback 確認兩者 head 相同；PR #206 為 OPEN/Draft、base `fix/reel-v3-two-reference-images`、branch `feat/aeo325-guardrail`。
- Item 7：本報告逐檔列出 `git diff --stat 766ada1c..HEAD` 涵蓋的 31 個檔案並解釋用途；`PAYLOAD.md` 使用最終 remote head，且隨最後回覆附上。

NOT_DONE| Item 4 | AI sitemap 基線缺 luxury bag service URL；未新增以遵守 URL set hash 限制。

# AEO325-B-r4 — Item 1 initial regression-test evidence

STATUS| PARTIAL
BRANCH| feat/aeo325-guardrail
START_HEAD| d396643b
PR| https://github.com/39211/laundry-social-auto-poster/pull/206

The 11 isolated mkdtemp docs-tree cases were added before production changes. Initial targeted run: npx vitest run test/aeo325Guardrail.test.ts -t "r4 scanner case" --reporter=verbose → 8 failed / 3 passed / 27 filtered out. Cases 01–08 failed against the existing scanner; cases 10–11 passed. Case 09 (/Services/<Slug>.HTML) already failed closed because assertNoUnapprovedAeo325Slugs lowercases the entire path/content source before running the lowercase URL patterns. The test remains as a required behavior check, but its baseline was already green, contrary to the task's expected-red statement.

| Case | Initial result | Evidence |
|---|---|---|
| 01 binary filename path token | RED | .png is skipped for contents; filename token not scanned |
| 02 .js filename path token | RED | URL regex does not treat . as a path boundary |
| 03 .htm filename path token | RED | extension and path boundary not recognized |
| 04 JS fetch JSON path | RED | URL regex misses slug before .json |
| 05 CSS image URL | RED | URL regex misses slug before .webp |
| 06 URL ending before newline | RED | old lookahead omits newline/whitespace boundary |
| 07 encoded URL in HTML | RED | %2F is not normalized |
| 08 encoded URL in JS | RED | %2F is not normalized |
| 09 uppercase URL | GREEN | existing source lowercasing already catches it |
| 10 bare CSS class | GREEN | non-URL bare content remains allowed |
| 11 exempt slug path | GREEN | down-vest-cleaning remains exempt |
## AEO325-B-r4 — Item 2 scanner correction

src/aeo325Guardrail.ts now token-scans every normalized output path (including binary allowlisted extensions), token-scans normalized contents for structured text, and runs the existing URL-shape checks against a lowercase normalized copy for other files. Content normalization converts %2f to /, %3a to :, escaped slash to /, and escaped backslash to /. URL shapes recognize .html and .htm; path suffixes use (?![a-z0-9_-]). The bare CSS class control and exempt down-vest-cleaning path remain allowed.

Validation: npx vitest run test/aeo325Guardrail.test.ts --reporter=verbose → 38 passed / 0 failed / 0 skipped. All 11 r4 cases pass after the fix.

## AEO325-B-r4 — Item 3 exact URL path-segment matching

The sitemap/RSS guard assertion now compares each URL pathname's slash-delimited segments to the exact slug, slug.html, or slug.htm. It no longer reports a slug that only appears as a substring in a dated feature-post segment. Regression evidence: before the path-segment implementation, the new feature-post case failed (1 failed / 38 filtered out); after the change, `npx vitest run test/aeo325Guardrail.test.ts -t "dated feature-post path|public sitemap" --reporter=verbose` passed both the collision case and the real sitemap/feed assertion (2 passed / 0 failed / 37 filtered out).
## AEO325-B-r4 — Item 4 luxury-bag store/pickup card

Updated only the existing card body in seo-overrides/services/luxury-bag-cleaning.html and copied it byte-for-byte to docs/services/luxury-bag-cleaning.html. The new PageCopy assertion checks the exact requested card text and rejects 台中全市, 保證, 承諾, and 滅菌. RED on old copy: 1 failed / 44 filtered out; GREEN after update: npx vitest run test/aeo325PageCopy.test.ts -t "luxury-bag store and pickup card" --reporter=verbose → 1 passed / 0 failed / 44 filtered out. SHA-256 of both page copies: 4F43E92F396C603BB409B9345A1C49B9A5522227DF37B6264F83BB6C8DF621BF.
## AEO325-B-r4 — Item 5 production mutation evidence

All three temporary mutations were applied to src/aeo325Guardrail.ts itself, run against the walk-through tests, and restored from their original bytes in a finally block:

| Mutation | Targeted red evidence |
|---|---|
| Remove normalized-path slug-token scan | punctuation-delimited output path test: 1 failed / 39 filtered out |
| Remove %2f normalization | case 08 encoded URL in JavaScript: 1 failed / 39 filtered out |
| Revert negative path boundary to the previous lookahead | case 06 newline URL boundary: 1 failed / 39 filtered out |

After restoration, the three same targeted tests passed together: 3 passed / 0 failed / 37 filtered out. git diff --exit-code -- src/aeo325Guardrail.ts confirmed no mutation residue. A separate punctuation-delimited path case was added because the required slash-prefixed filenames are also caught by the broadened URL pattern; without a case isolating the token scan, removing that scan alone would not make those examples red.