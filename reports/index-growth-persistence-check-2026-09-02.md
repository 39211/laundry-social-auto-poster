# 實驗持久性檢查（2026-09-02）

## 結果

企業大量頁／價目頁的正文連結目前在 live HTML 保留。每日生成來源仍有不同：企業頁的產生器有通用價目連結條件，價目頁的服務定義尚未包含本次新增的企業大量正文連結；若未來重新生成，手工 overlay 可能被覆蓋，因此不可把本次變因誤當成永久模板變更。

## 排程證據

- `Laundry-Daily-Generate`：Windows Task Scheduler 狀態為 `Disabled`。
- `Laundry-GA4-Collect` 與 `Laundry-GSC-Collect`：狀態為 `Ready`，只負責資料收集。
- `Laundry-Publish-1130/1200/1400/2030`：會執行 catch-up 發布；其重新生成條件是當日 `docs/assets/YYYY-MM-DD/slot-01.png` 存在且對應 live hero 非 200。
- 今日 `docs/assets/2026-09-02/slot-01.png` 不存在，所以本日沒有符合重新生成條件的覆蓋路徑。

## 影響與控制

本次 live 實驗的 treatment hash、Pages run、IndexNow 與兩頁 HTML 證據已寫於 [內鏈實驗紀錄](index-growth-contextual-link-experiment-2026-09-02.md)。在第 7／28 天判定前，若排程狀態或當日 hero 條件改變，必須先重做 live treatment 檢查；若 overlay 消失，該觀測窗標記為無效，不補改第二個變因。
