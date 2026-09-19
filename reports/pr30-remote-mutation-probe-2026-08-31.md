# PR #30 remote mutation probe（2026-08-31 16:40）

## 執行環境

- 遠端 HEAD：`ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`
- 暫存 sparse clone：`C:\Users\cyc39\AppData\Local\Temp\sxj-pr30-sparse-b6b3a40930024e1b82cf4cb5e0fb811a`
- 使用 `npx tsx` 匯入 PR 的 `src/indexGrowthPages.ts`，每個 case 先深拷貝 catalog；未修改主工作樹。
- baseline：`validateIndexGrowthPages(..., {today: "2026-08-31"})` → `ok=true failures=0`。

## 實測結果

| mutation | validator 結果 | resolver／判讀 |
|---|---|---|
| 將 `suede-shoe-cleaning` citation source 改指另一個合法 registry key | `ok=true` | claim-level source 可錯配，未被抓到 |
| 將 `content_revision` 改成 `2026-08-30#999` | `ok=true` | 任意 revision 可通過 |
| 將 section body 改成長度足夠的新內容 | `ok=true` | 正文改寫未觸發 immutable content hash |
| 將 `clothing-mold-airing` 改成戶外用力抖／刷／拍霉屑 | `ok=true` | 不安全內容沒有 safety gate |
| 將 `svc:shoe-bag-care` registry `origin`／`note` 清空 | `ok=true` | registry key 存在就足夠，沒有 locator／摘要／hash 要求 |
| 刪除 `suede-shoe-cleaning.publish_state` | `ok=true` | validator 仍通過；`resolveAcceptedIndexGrowthPages` count 變成 23，形成 validator／resolver 不一致 |

## 決策

這不是測試套件失敗，而是證明目前綠燈 validator 仍不足以作 production release gate。PR #30 必須先修正上述六項，並讓每個 mutation 在移除／不匹配時變紅、還原同一變更回綠；在此之前，候選頁不可部署或計入 indexed growth。

## 同一物件原地還原驗證（16:48）

在同一個暫存 catalog 上執行「mutation → validate → restore → validate」，避免只靠兩份獨立副本：

| case | mutation 後 | 還原後 |
|---|---:|---:|
| 移除 `citation_answer` | `false` | `true` |
| 合法 source ref 錯配 | `true`（錯放） | `true` |
| 任意 `content_revision` | `true`（錯放） | `true` |
| 長正文改寫 | `true`（錯放） | `true` |
| 不安全 mold 指令 | `true`（錯放） | `true` |
| registry origin／note 清空 | `true`（錯放） | `true` |
| 移除 `publish_state` | `true`（錯放），resolver 23 | `true`，resolver 24 |

這確認現有 citation fallback 閘門可變紅／回綠，但其餘六項仍無法 fail-closed；因此 `typecheck-and-test` 綠燈不能升格為發布核准。
