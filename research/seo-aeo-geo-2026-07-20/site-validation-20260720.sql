-- Reproducible diagnostic-layer snapshot from public HTTP checks and Search Console review.
WITH diagnostic_layers (layer, status, evidence) AS (
  VALUES
    ('1 抓取', '通過公開測試', '首頁、robots、sitemap 與 44 個 sitemap URL 均回 HTTP 200'),
    ('2 索引', '未通過', '7/10 報表只有舊子路徑 1 頁；首頁即時可索引但尚未收錄'),
    ('3 排名', '僅有早期訊號', '平均排名 7，但樣本只有 135 次曝光'),
    ('4 AI 引用', '未量測', '尚無 Bing AI Performance 或其他 citation 報表證據'),
    ('5 網站流量', '少量', 'Google 搜尋帶來 2 次點擊'),
    ('6 LINE／預約', '無法歸因', '沒有站內 outbound click 與預約端核對資料')
)
SELECT * FROM diagnostic_layers ORDER BY layer;
