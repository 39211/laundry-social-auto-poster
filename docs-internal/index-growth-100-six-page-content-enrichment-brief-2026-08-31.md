# GSC 六頁內容加厚 brief — 2026-08-31

## 目的與邊界

這份 brief 只處理目前 GSC `Discovered - currently not indexed` 的六個既有 URL，不建立同義 URL、不複製城市頁、不改排程或發布資料。目標是讓每頁有一段意圖專屬、可由現有服務流程核對的正文，降低短頁共用段落比例；不是收錄保證。

目前 live sitemap 仍為 32 URL；六頁均 HTTP 200、self-canonical、可解析 JSON-LD、沒有 noindex。以下文字是候選草案，實作者仍須在授權 PR 中逐句對照 live 服務事實與店主可證明的流程。

## 六頁最小變更

| URL | 主要意圖 | 建議新增的正文小節與草案 | 必要證據／限制 |
|---|---|---|---|
| `services/taichung-citywide-laundry-pickup.html` | 台中其他行政區如何開始收送 | **收送前先準備什麼**：`不方便到店時，可以先用 LINE 傳整體、標籤與問題位置的照片，說明住在台中哪一區、物件種類與大概數量。先確認收送安排，再由門市依材質與狀態說明清潔方式；收送免費不等於清潔免費。` | 只使用頁面已有的全市收送、LINE、照片、費用界線；不得承諾時效或效果。正文加回洗衣搜尋指南內鏈。 |
| `services/business-bulk-laundry.html` | 公司／店家批量送洗前的交接 | **批量詢問清單**：`一次有多件制服、工作衣、毛巾或床組時，先把品項、數量、顏色、洗標與最在意的髒污列成清單，再補上照片。這樣門市能先分辨材質與交接方式；未檢視物件前，不先承諾固定報價、完成天數或所有污漬都能去除。` | 沿用既有處理界線；不得加入不存在的最低件數、企業 SLA 或報價。 |
| `services/taichung-laundry-price-list.html` | 看到參考價後如何判斷實際報價 | **參考價怎麼使用**：`先把參考價當成詢問起點，不要把水洗數字當成所有材質的固定價。若是鞋面泛黃、包身痕跡、發霉或特殊材質，傳整體與局部照片，讓門市先分辨水洗、乾洗、柔洗或需要另行評估的情況。` | 保留頁面既有 $70–$2500 參考價與「非固定價」限制；正文補回白鞋黃化、精品乾洗兩個 live 指南內鏈。 |
| `services/taichung-xitun-laundry.html` | 西屯門市與服務分流 | **門市頁與指南頁怎麼分工**：`如果已知道要到青海路二段365號，可先從門市頁確認地址與服務範圍；如果還在比較洗衣、洗鞋、洗包、收送或價格，先看搜尋指南，再回到對應服務頁。物件仍要以材質、痕跡位置與照片判斷，門市頁不是把所有問題塞在一起的目錄。` | 只使用既有地址、服務頁、搜尋指南與照片流程；不得捏造交通時間、停車資訊或分店。 |
| `guides/taichung-laundry-service-search.html` | 資訊型「怎麼找」與意圖分流 | **三個問題先分流**：`先回答三件事：手上是什麼物件、最困擾的是哪種狀況、需要到店還是收送。物件決定要看的材質與檢查位置，問題決定要先看泛黃、潮味、油痕或磨損，收送需求再決定是否先傳照片。這樣比只搜尋「洗衣店」更容易找到能核對的服務頁。` | 維持資訊型語氣，不能把指南改成門市廣告；每個例子需連到現有 live 服務頁。 |
| `services/fabric-storage.html` | 換季收納前的檢查與清潔判斷 | **收納前檢查紀錄**：`收進袋子前，先記下接觸皮膚的位置、是否有汗味或潮氣、黃斑／灰塵在哪裡，以及洗標與材質。若有第一方案例，應附拍攝日期、物件類型與檢查前後可核對的照片；沒有這些紀錄時，只能寫檢查流程，不宣稱已完成客件成果。` | **必須取得合法第一方案例與 asset ledger 綁定後才可寫案例結果**；目前 shared hero 不足以通過 provenance gate，未取得證據前只發布流程段落。 |

## 共通品質閘門

1. 每頁新增段落必須在 `<main>` 正文，不放 FAQ、footer、schema 或只供 crawler 的檔案。
2. 段落需有單一查詢意圖、與其他五頁不能只替換地名或品項；不得加入關鍵字清單、虛構評論、固定時效、必定去除或價格保證。
3. 保留現有 self-canonical、JSON-LD、`dateModified`、robots 與原有服務限制；答案／meta／OG／Twitter 需同時檢查品牌是否仍後置於答案。
4. 所有新增內鏈必須指向目前 HTTP 200 的 live URL；候選 24 頁或 404 URL 不得先當作閉合目標。
5. 布品案例只有在第一方照片、拍攝／接收日期、物件描述與 claim-level provenance 均存在時才可由 `draft` 升為 `accepted`。
6. 在 PR #30 的 provenance、revision/hash、resolver、semantic safety、exact host 與 whole-path mutation gate 通過前，不做 HTML／SEO-only overlay 或 IndexNow 重送。

## 成效判定

- Day 0：記錄六頁 URL、目前 GSC 狀態、正文段落雜湊與 live sitemap `lastmod`。
- 7 日：若 GSC 有新快照，觀察 indexed／discovered 狀態、impressions、clicks、CTR；沒有新快照則維持 `PENDING`，不可填 0。
- 28 日：只有在資料完整且達到預先設定的 impressions／CTR／indexed 判定規則時才可 `ADOPT`、`RETEST` 或 `REJECT`；GA4 缺欄位維持 `null/unmeasured`。

這份 brief 是實作輸入與驗收契約，不是已修改 live source 的聲明。

## 20:49 需求訊號綁定（只用已取得的 GSC）

| 頁面 | 可觀測訊號 | 方策／固定控制 |
|---|---|---|
| `services/taichung-citywide-laundry-pickup.html` | 目前快照沒有直接 query 證據 | 只測收送前照片／費用界線；不把台中行政區拆成多頁 |
| `services/business-bulk-laundry.html` | 目前快照沒有直接 B2B query 證據 | 只補交接清單；最低量、交期與案例數字維持未知 |
| `services/taichung-laundry-price-list.html` | 目前快照沒有直接價格 query 證據 | 只補參考價使用方式；不承諾固定報價 |
| `services/taichung-xitun-laundry.html` | 目前快照沒有直接西屯 query 證據 | 保留地址／服務分流；不擴成西屯地名網 |
| `guides/taichung-laundry-service-search.html` | 目前快照沒有直接指南 query 證據 | 維持資訊型分流；不改成門市廣告頁 |
| `services/fabric-storage.html` | 目前快照沒有直接收納 query 證據 | 只寫檢查流程；沒有第一方照片就不寫案例成果 |

需求綁定的目的，是避免把「六頁都是 discovered」誤讀成六個已證實的市場需求。另有非六頁訊號（白鞋頁 3 impressions／1 click、勃肯鞋指南 12 impressions、絨毛娃娃 query 1 impression）只能用來排序既有頁優化，不能直接授權新 URL。 
