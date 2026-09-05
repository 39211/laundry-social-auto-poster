# PR #30 mutation gate 重驗（2026-08-31）

## 執行環境

- sparse checkout HEAD：`ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`
- 命令：`npx.cmd tsx probe-index-growth.ts`
- 探針只在程序記憶體複製 catalog／registry，不寫回 repo 或 live 網站。

## 結果

| Mutation | 期待 | 實際 | 判定 |
|---|---|---|---|
| baseline | `ok=true` | `ok=true`、0 failures | PASS |
| 將 citation source ref 改綁另一個合法 ref | 應 fail（claim-level provenance） | `ok=true` | **FAIL-OPEN** |
| 將 content revision 改成任意 `#999` | 應 fail（revision/hash） | `ok=true` | **FAIL-OPEN** |
| 改寫一段仍足夠長的正文 | 應 fail（immutable content revision/hash） | `ok=true` | **FAIL-OPEN** |
| 將 clothing-mold answer 改成戶外抖／刷霉屑 | 應 fail（安全內容） | `ok=true` | **FAIL-OPEN** |
| 清空 registry origin／note | 應 fail（provenance record） | `ok=true` | **FAIL-OPEN** |
| 移除 publish_state 後跑 resolver | 應維持明確狀態邊界並拒絕 | `ok=true`、resolver count `23` | **FAIL-OPEN** |

## 判讀

目前 validator 能抓到欄位缺失、長度、重複與部分格式錯誤，但不能證明 claim-level provenance 不可被重綁、內容 revision 與 body hash 有關、衣物發霉安全語意存在，或缺失 publish state 會 fail closed。`npm test` 的 87/710/16 綠燈不能覆蓋這些未被測試的語意閘門。

## Release 決定

`REWRITE_REQUIRED`。在上述 mutation 對應的測試「移除→變紅、還原→回綠」之前，不得把 24 頁候選加入 sitemap、部署或送出新的索引提交。

## Restore probe 與 host probe 補充

- 完整 restore probe：baseline `true`；移除 citation `mutated=false/restored=true`，其餘 source-ref、revision、body、mold、registry、publish-state mutations 均 `mutated=true/restored=true`（這些本應是 fail，因而證明 fail-open）。移除 publish state 時 resolver 為 23，還原後為 24。
- 在程序環境設定 production host 後，`https://evil.example` 會被 `generatePublicSite` 拒絕；合法 host 接著因隔離資料目錄缺 business profile 而停止。這只證明 generator 的 host gate，不能證明 `publishPages` 每條 production path 都先套用同一 gate。
