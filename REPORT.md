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
