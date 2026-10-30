# B2-4 結果：週報讀取來源→收件彙總

## 變更
- `scripts/weekly-report.py`
  - 新增讀取 `data/conversions/source-to-order-<週>.json`，以及 `history/source-to-order-<週>.r<N>.json`。
  - 版本選擇規則：只取 cohort_week 相符、驗證通過、且 as_of 不晚於 --as-of 的版本，再取其中最高 revision。多個版本不相加。
  - 匯出檔缺檔時顯示 `來源→收件：尚無資料（exporter 未產出）`。
  - 空檔、壞檔、版本不相容、缺覆蓋聲明、列不守恆時，顯示 `來源→收件：未知（原因；不補 0）`，原因同時列入「讀取問題」。
  - 新段落置於成效表之後，內容依序為：
    - `###` 標題：週、版次、匯出時間、上週詢問數；status 為 lower_bound 時加註（下限，資料不完整）。
    - I7 一行。
    - 三欄表。
  - 來源標籤：讀 `data/attribution/source-codes.json`，顯示 `來源碼／content_id`；查無對應時只顯示來源碼。`unknown` 顯示為未知來源。來源碼不合格時顯示「不合格來源碼」。
  - 行數控制：整份週報仍以 60 行為上限。放不下時，只保留詢問數最多的 5 個來源，加上 unknown，並註明（其餘 n 個來源省略）。仍放不下時再減少來源數，最後退為一行省略說明。
  - 為騰出行數，「資料口徑」段由 9 行併為 4 行，「期間」與「成效」兩行合併為 1 行。文字內容保留，markdown 原本就把相鄰行渲染成同一段落。
- `test/test_weekly_report.py`：原 23 項維持不變，新增 7 項（共 30 項），仍以 subprocess／runpy 呼叫腳本。

## 執行
`python -I -S -B -m unittest test.test_weekly_report`