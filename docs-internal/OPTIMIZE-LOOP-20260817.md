# 優化工作輪 v2(2026-08-17 老闆定調)

> 老闆原話定義的優化:「你這幾天做錯了一堆任務,這些都是你要優化的地方,這才是優化的目的。」
> 三個支柱:**①把我犯過的錯變成系統性修正 ②把給過的 GitHub 挖乾淨,最大化影片內容與吸引力 ③每天量測「有沒有比昨天進步」**。
> 取代 ACCEPTANCE-AUDIT-20260816 的 D 節佇列(該佇列 7 項已完成 6 項,剩 A7 併入本表)。

## 運作模式(2026-08-17 02:00 改制:總指揮制,不是我單線自幹)

> 老闆糾正:「我要的是全部的 LOOP,寫好目標的派工單給我」——優化輪改為**派工板制**:
> 我出契約、路由、join 收卷、獨立驗證、裁決;實作與偵查交艦隊並行。裁判不下場踢球。

### 派工板(契約正本在 `C:\Users\cyc39\Documents\AI_Agency\_bridge\tasks\sxj-board0817-*.md`)

| 線 | TaskKey | 目標 | 席 | 狀態 |
|---|---|---|---|---|
| R1 | BOARD0817-VFP | G1 VideoForge-Pro 挖乾淨(轉場/節奏/BGM/模板→吸引力技術清單) | grok 唯讀 | ✅回卷驗訖 |
| R2 | BOARD0817-PSMINES | E2 全 .ps1 掃四類地雷(冒號變數/吞錯/NonInteractive/cp950) | grok 唯讀 | ✅回卷驗訖 |
| R3 | BOARD0817-IGGAP | E4 IG 量測率 25% 根因(52 筆 null 分類+修法) | grok 唯讀 | ✅回卷驗訖 |
| R4 | BOARD0817-CAPT | G2 船長七模組落地稽核(找沒吃乾淨的) | grok 唯讀 | ✅回卷驗訖 |
| R5 | BOARD0817-NIGHTLY | E3 夜檢恆真項複審(B9 外推) | grok 唯讀 | ✅回卷驗訖 |
| R6 | BOARD0817-VQSPEC | E1 視覺 QA 規格(校準協定:壞例必紅) | grok 唯讀 | ✅回卷驗訖 |
| R7 | BOARD0817-TRAFFIC | **推流方向偵查(老闆點名):先方向後加強,GA4/索引/GBP/AEO 該往哪打** | grok 唯讀 | ✅回卷驗訖 |
| R8 | BOARD0817-NIGHTREV | 昨夜五 commit 跨家族缺陷複審(六不變量逐條) | luna 唯讀 | ✅DEFECTS_FOUND(14)→併入 W-REPAIR |
| W1 | w-repair | E2 修雷 27+luna 14 缺陷合併修復 | grok 實作 | 🔥點火中 |
| W2 | w-a7 | A7 改題自動重生圖(規格已灌:10 條款) | grok 實作 | 排隊(W-REPAIR 後) |
| W3 | (預備)w-vq | E1 視覺 QA 實作(等 R6+Opus 終裁附錄) | grok 實作 | 待點火 |
| 裁決 | — | R6 規格回卷後 Opus 深審→產出 W3 附錄條款 | Opus | 排隊 |

⚠ 共享樹單一 writer:W1/W2/W3 依序點火,不並行;唯讀線不受限。
⚠ 複審期間標的凍結:R8 在跑,f9676e2..d4ee919 涉及的檔案**這段時間不動**。

### 每輪固定動作(總指揮輪)

1. **發布保全**:posted-log 對時刻表,窗口內該發沒發立刻救。
2. **進步帳**:`python scripts/daily_progress.py`;↓ 開根因、連兩天 ↓ 升 P0、null 查原因。
3. **join 收卷**:`python C:\Users\cyc39\Documents\AI_Agency\_bridge\joiner.py --last 12`;
   只讀例外;PAYLOAD 逐欄獨立驗證(退出碼與自述不採信);
   偵查回卷→補附錄→**同回合**點下一張實作單;判 REWRITE 就改契約重送。
4. **grok 空轉檢查**:ready queue 有單、有空位就點;閒置即失職。
5. **新片逐幀複驗**:`.frames/` 過故事軸;R8 凍結解除前不動被審檔。
6. **失手→F 條目→防再犯進板**。

## 佇列(依序消化)

### P0|錯誤模式 → 系統性修正(支柱①)
- [ ] **E1 影片連戲 AI 視覺 QA**(F13 根治):用 Codex 視覺呼叫自動判「前中後同物件/狀態順序」,
      取代人眼抽查;用 suede 壞例當紅例校準,healthy 三例當綠例,無鑑別力不上線。
- [ ] **E2 PS 腳本地雷總掃**(F12 外推):全 scripts/*.ps1 掃 `$var:` 冒號陷阱與 `| Out-Null` 吞錯點,
      逐一修或加 log;產出清單進 commit。
- [ ] **E3 夜檢恆真項複審**(B9 外推):nightly findings 逐條問「一切正常時會不會亮」,會亮的重寫。
- [ ] **E4 IG 成效缺口**(進步帳首日發現):69 篇只量到 17 篇,查 media id 缺失根因,把可量測率做到 90%+,
      否則進步帳的 IG 欄永遠半盲。

### P1|GitHub 深挖 → 影片吸引力(支柱②)
- [ ] **G1 VideoForge-Pro 二次深讀**:composer 的轉場庫/BGM ducking/節奏參數、script templates 的
      敘事結構、exporters 的平台規格 —— 逐項寫成「技術→預期效果→驗證指標」進 `video-production/enhancement-backlog.md`。
- [ ] **G2 船長AI視界 7 模組落地稽核**:逐模組對照產線現況,找「精讀了但沒吃乾淨」的部分,補落地。
- [ ] **G3 cugfei/VideoForge 功能清單回訪**:GUI 端的字幕樣式/批次處理概念,可搬的搬。
- [ ] **G4 挖出的技術逐一排進 A/B**:一批一變數,對 `ig_reels_avg_watch_time` 與觀看數驗收;
      字幕批(8/17-19)是第一個,基線 3.9s。
- 深挖紀律:**先完整讀,再提案,附檔名行號**;「掃過 README」不算挖。

### P2|架構與線頭
- [ ] **A7 改題自動重生圖**(審計遺留):行事曆改題後,舊圖自動判失效並重生,不等人發現文不配圖。
- [ ] **GBP 接線**:OAuth client 步驟文件→老闆點完→refresh token 進 .env→週貼文+回評程式(source=gbp)。
- [ ] **網域切換後鏈**(DNS 生效自動觸發):.env→重生站→CNAME→Pages→HTTPS→新網域 IndexNow→GSC TXT 給老闆。
- [ ] **營收 OS 週節奏啟動**:plan-log/weekly 第一份週複盤(週日),用進步帳七天數據填。

## 老闆的任務(等你,不催但每天 8 點報告帶到)

| 任務 | 卡在哪 | 我已備好 |
|---|---|---|
| 看片驗收 | suede 重生版今天出爐 | 逐幀複驗過才會送你 |
| GBP OAuth client | 要你的 Google 帳號進 Cloud Console | 步驟文件(GBP 接線項) |
| 營收 OS 曆法拍板 | 窗口 08-13~11-15 vs 現行 10-08 | 檔頭注記+兩案對照 |
| GSC 驗證 | 網域生效後要你 Google 帳號建資源 | TXT 值產出後給你,面板 TEXT 區我來填 |
| PowerWeb 密碼更換 | 你說先不改 | 提醒保留:原密碼走過明文信+對話 |
| LINE OA / 人設臉 | 你的時間 | 兩案已在前期文件 |

## 進步帳(支柱③)

- 正本:`reports/daily-progress.md`;引擎:`scripts/daily_progress.py`(day-reports + IG insights + indexing-push 三源)。
- 鐵則:null=未量測≠0,不算退步但必須查;比較永遠是「昨天 vs 前天」,因為 GA4/IG 隔夜才熟。
- 目標:每天至少一項 ↑,且 null 欄位逐週變少。

### 03:10 板況增補
- W-IGFIX ✅ 結案 commit ad38f8f:IG 量測 52/69 整包失敗已修(指標拆組),12/12 綠+突變 3 紅;總指揮收卷補 2 行型別窄化(grok 沒跑 tsc,tsx 不查型別——老坑)。
- 新增 ready:w-nightly(夜檢降噪,R5 判定已灌)。
- ⚠ MOTIONSPEC 揪出 **8/18 slot3 綁了 8/14 才播過的 luggage-wheel 同一支成片**(video_sha256 相同=4 天內重播)。處置:今天產線照 plan 產 heel-tip-scuff → heal 8/18;8 點檢查與今日產線驗證此項。
- Opus 裁決:R6(視覺QA)+MOTIONSPEC(分鏡真相化)合併深審,產 W3/W4 附錄。
