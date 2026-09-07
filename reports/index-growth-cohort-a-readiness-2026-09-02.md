# Index-growth Cohort A readiness — 2026-09-02

## 判定

這是 `shoe-odor-source` pilot 後的離線候選檢查，不是發布許可。五頁各自回答不同鞋材質／處理決策，沒有新增城市替換頁；目前全部維持 `HOLD_UNTIL_PILOT_ADOPT`。

## 離線結果

來源：隔離部署樹 `sxj-index-growth-pilot-minimal-20260902/docs/guides`。正文長度為去除 script、style、HTML 標籤後的字元數。

| 候選頁 | 主要問題意圖 | 正文字元 | canonical | answer surface | 站內連結 | 結構判定 |
|---|---|---:|---|---:|---:|---|
| `suede-shoe-cleaning` | 麂皮鞋變硬／發亮能否自行處理 | 1,241 | self | 1 | 25 | `STRUCTURAL_PASS` |
| `canvas-shoe-mud` | 帆布鞋沾泥要等乾還是立刻刷 | 1,159 | self | 1 | 25 | `STRUCTURAL_PASS` |
| `leather-shoe-water-marks` | 皮鞋雨痕能否先上油 | 1,158 | self | 1 | 25 | `STRUCTURAL_PASS` |
| `washing-machine-shoe-risk` | 鞋子能否丟洗衣機 | 1,200 | self | 1 | 25 | `STRUCTURAL_PASS` |
| `athletic-shoe-mixed-materials` | 網布／膠邊／內裡是否要分開處理 | 1,190 | self | 1 | 25 | `STRUCTURAL_PASS` |

## 尚未解除的 gate

1. `shoe-odor-source` pilot 必須先完成 2026-09-09 第 7 天與 2026-09-30 第 28 天觀測；未達 `ADOPT` 不增加 URL。
2. 每頁仍需重新確認 claim-level provenance、素材 provenance、答案／meta／OG／Twitter 三面同步、完整內鏈目標 live 200、safety language 與 production exact-host。
3. HTTP 200、隔離 sitemap 或 IndexNow 回應不能替代 Google URL Inspection／Page Indexing 證據。
4. 若 28 日資料缺 GSC 非品牌曝光、GA4 organic 或 LINE click 任一關鍵欄位，判定為 `INCONCLUSIVE`，不是成功。

### Provenance recheck

五頁答案面目前都能在隔離的第一方建置樹 `docs/index.html` 找到相同 rendered surface（逐頁 line reference 已寫入 `docs-internal/index-growth-100-cohort-a-provenance-2026-09-02.json`），因此由「找不到站內來源」降為 `PARTIAL_MATCH_ONLY`。這不是獨立客案、照片或店方流程紀錄；`independent_case_evidence` 與素材 provenance 仍未建立，不能解除發布 gate。

## Link closure recheck

五頁候選與 pilot 的 guide 連結共指向 10 個 guide URL；其中 5 個既有 guide 目標目前 live 200，另外 5 個正是 Cohort A 候選、目前 live 404。這不是發布失敗，而是明確表示 Cohort A 若獲准，必須五頁同批 overlay 後再做一次 live 200 closure；單獨發布任一頁都會留下可預見的 404 內鏈，因此目前維持 `HOLD_UNTIL_PILOT_ADOPT`。

## 放量規則

只有 pilot 在 28 日內被確認收錄且出現非品牌曝光，並有 GA4 自然搜尋或 LINE 訊號，才允許從這五頁中挑 4–6 頁做下一個 cohort；每頁部署前重新跑同一組品質 gate。150／200 里程碑維持延後至 100 indexed 以後。

可執行的五頁 overlay、sitemap 差異、hash 與解除 gate 前置條件已封裝於 [Cohort A release package](../docs-internal/index-growth-100-cohort-a-release-package-2026-09-02.json)。封裝不代表已核准發布。

## 最新公開需求型態（只作排序，不作流量估計）

本回合重查公開結果，看到的重複需求型態是「台中洗鞋／洗包＋到府收送」、「麂皮鞋變硬／發亮」、「帆布鞋沾泥先等乾」、「皮鞋雨痕與上油風險」；這些支持 Cohort A 的問題分流，但沒有提供月搜尋量或收錄保證。觀察來源：[E.S.L 台中洗鞋](https://www.eslclean.com/)、[Rebirth 台中洗鞋](https://rebirth407.com/)、[OC 鞋包護理公開服務頁](https://www.cleaners10.com/TW/Taichung/153741931853374/Oc%E9%9E%8B%E5%8C%85%E8%AD%B7%E7%90%86%C2%B7%E6%B8%85%E6%BD%94%E4%BF%9D%E9%A4%8A%C2%B7%E9%8D%8D%E8%86%9C%C2%B7%E6%95%B4%E6%9F%93%C2%B7%E9%99%A4%E9%9C%89%C2%B7%E5%88%B0%E5%BA%9C%E6%94%B6%E9%80%81)、[帆布清洗步驟參考](https://tw.rosylily.co.jp/pages/canvas2)。不複製競品價格、案例或文案。
