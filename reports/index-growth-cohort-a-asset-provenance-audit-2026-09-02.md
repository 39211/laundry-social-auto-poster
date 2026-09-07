# Cohort A 素材 provenance 稽核（2026-09-02）

## 判定

Cohort A 五頁目前仍不能解除 `HOLD_UNTIL_PILOT_ADOPT`。離線候選目錄有圖片檔，但沒有足以證明「第一方實際客件」的來源紀錄；不能把檔案存在誤當成案例證據。

## 可核對證據

- `data/asset-ledger.json` 目前只有 6 筆舊登錄，沒有 `suede-shoe`、`canvas-shoe`、`leather-shoe`、`washing-machine-shoe` 或 `athletic-shoe` 候選素材的 entry。
- `data/reference-photos/` 下雖存在部分候選圖片目錄，但沒有與候選頁綁定的 owner consent、來源 URL／交付紀錄、拍攝日期或 immutable hash sidecar。
- `docs-internal/index-growth-100-cohort-a-provenance-2026-09-02.json` 已把五頁標為 `PARTIAL_MATCH_ONLY`，`independent_case_evidence` 與素材 provenance 仍缺失。

## 影響

目前 `verified_first_party_assets = 0/5`；五頁只能作離線草稿，不能加入 live sitemap、不能宣稱真實案例、不能以圖片存在替代第一方證據。這也符合官方 people-first／原創內容要求與現有 PR #30 fail-closed gate。

## 解除條件

每頁至少要有可追溯的素材來源、店方／客戶使用同意（若適用）、原始檔雜湊與頁面 claim 對應；完成後再重跑 provenance、safety、link closure、host 與 mutation gate。未完成前不發布、不提交新的索引請求。
