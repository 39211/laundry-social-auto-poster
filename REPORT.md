# AEO325-B-r2 Report

STATUS| PARTIAL
BASE| 766ada1c

## Item 0 — 拆 overlay 與 slug 級豁免

- 已把六份 `docs/services/`、`docs/guides/` 目標頁及兩份 sitemap 還原至基底 `766ada1c`。
- 已從 `src/generatePublicSite.ts` 拆除精簡 HTML overlay 型別、資料、builder、root 開關、AEO325 sitemap lastmod 參數與相關分支。保留 `loadAeo325Guardrail`、`assertAeo325PublicOutputSafety`、sitemap 過濾掛鉤與 `SOURCE_PROJECT_ROOT`（僅供 guardrail 設定載入/掃描）。
- `config/aeo325/public-url-baseline.json` 現以 slug 級 `pre_existing_slugs` 列出 `down-vest-cleaning`、`gore-tex-jacket-cleaning` 及豁免理由；程式限定清單恰為這兩項。`approvals.json` 未修改，兩列仍未核准。sitemap/AI sitemap/RSS URL 集合 count/hash 基線未修改。
- TDD 紅：在實作前，`npx vitest run test/aeo325Guardrail.test.ts -t "allows only the two legacy slugs anywhere"` 為 1 failed / 16 skipped，舊 API 沒有 `preExistingSlugs` 欄位。綠：`npx vitest run test/aeo325Guardrail.test.ts` 為 17 passed / 0 failed / 0 skipped。實作後首次測試曾因合成 slug 不在正式 325 筆清單而誤測；修正測試從 catalog 選取非豁免 slug 後重跑綠。
- `npm run typecheck`: PASS；本次未暫存 source diff 的 whitespace check 無錯。`git diff --cached --check` 會標出從 `766ada1c` 原樣還原的 HTML 既有尾端空白；沒有為消除提示改寫要求精確還原的基底頁。新加入的 `docs-internal/aeo325/` 輸入檔亦有原始空白行，依契約保持不動。

## 開工基線

- 按契約跑 `npx vitest run test/publicSite.test.ts -t "keeps checked-in public feeds"`。第一次沒設必要的 `PUBLIC_SITE_BASE_URL`，在模組載入期中止、沒有測試結果；設定 `PUBLIC_SITE_BASE_URL` 與 `PUBLIC_IMAGE_BASE_URL` 為 `https://sixiangjialaundry.com` 後重跑，結果 1 failed / 48 skipped。唯一失敗為既有 `2026-09-15-0: expected undefined to be defined`（`test/publicSite.test.ts:2965`，calendar/feed slot 不一致）。這是唯一准許保留的全套基線紅。

## Item 1 — 基底 page-marker fixture

- `test/fixtures/aeo325/base-page-markers.json` 是直接從每一個 `git show 766ada1c:seo-overrides/<path>` 內容抽取，沒有手填 marker。
- 六個集合欄位為 `meta_names`、`meta_properties`、`link_rels`、`jsonld_types`、`section_aside_ids`、`script_srcs`。抽取時去重並排序。六頁各集合數依序是：白鞋服務 `11/8/2/21/5/2`、白鞋指南 `11/8/2/24/3/2`、精品包服務 `11/8/2/24/2/2`、精品包指南 `11/8/2/24/2/2`、羽絨服務 `11/8/2/21/2/2`、羽絨指南 `11/8/2/24/3/2`。
- 重現指令（PowerShell，輸出至同一 fixture）：

```powershell
@'
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
'@ | node -
```
- 已從 REPORT 內複製指令重跑；檢查確認 fixture 是 6 頁、每頁 6 個陣列集合，SHA-256 開頭 `F4A7AD3088CD5856`。

## Item 2 — Page-copy test first red (scope decision pending)

- 新測試檔：`test/aeo325PageCopy.test.ts`；包含 JSON-LD parse、final 文案與 heading 順序、FAQ 三方相同、marker superset、禁詞/消毒/交期、docs/override bytes、description/dateModified/hero time/sitemap 的檢查。
- 紅測：`npx vitest run test/aeo325PageCopy.test.ts --reporter=dot`，基底輸出 `Test Files 1 failed (1); Tests 28 failed | 14 passed (42)`。例如白鞋服務 lead 目前仍是舊句，期望值是 final r3 導言；舊 FAQ、四頁 HowTo、日期與 description 也各自報紅。基底 6 頁 JSON-LD 可解析，且 docs/override 原始 bytes 相同。
- `npm run typecheck`: PASS。
- 測試目前把禁詞範圍解作本輪替換 lead/文案區塊、FAQ 與自有 JSON-LD；但契約指定保留的羽絨服務 `#consolidated-notice` (`seo-overrides/services/down-jacket-cleaning.html:302`) 與指南 `#down-price-split` (`seo-overrides/guides/down-jacket-cleaning.html:504`) 可見文字都含「消毒／醫療滅菌」。已送店主選擇題裁定禁詞掃描口徑；未收到答覆前不改任何目標頁，也不把這個測試標完成。

## 待完成

- Item 2：禁詞範圍裁定後完成測試並 commit。
- Item 3–4：六頁原位改稿與兩 sitemap lastmod。
- Item 5：全套測試及完整範圍核對；唯一准許的已知失敗如上。
- Item 6–7：push、更新 Draft PR #206、補齊 REPORT/PAYLOAD。

NOT_DONE| Item 2 | 禁詞掃描範圍與保留羽絨區塊有衝突，等待店主從選擇題裁定。
NOT_DONE| Items 3–7 | 尚未執行；本輪狀態 PARTIAL。
