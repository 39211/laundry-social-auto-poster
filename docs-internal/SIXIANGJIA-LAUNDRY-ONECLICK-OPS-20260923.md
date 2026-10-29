# 私享家洗衣店｜一鍵發佈形作業包（EZup 形狀、合法路線）

**版本：** 2026-09-23  
**適用：** 私享家旗艦店（台中｜FB／IG 日更＋Reel＋官網資產）  
**硬禁：** FB 社團／Marketplace／桌面 RPA 模擬發文。只走 **官方 Meta API**＋現有 Windows 產線。  
**機台：** Windows `ai`  
**根目錄：** `C:\Users\cyc39\Documents\New project 5`（junction：`C:\Users\cyc39\laundry-repo`）

---

## 1. 產品一句話

> **餵「今天的槽＋主題」→ 自動長成可發資產 → 人眼／真實感閘 → 官方排程窗內一鍵 catch-up → 晚上回報狀態。**

對照 EZup：學「單一輸入、隊列、生命週期、遠端狀態」；不學「刷社團」。

---

## 2. 三槽定義（唯一真相）

| 槽 | 時間（Asia/Taipei） | 典型媒體 | 備註 |
|----|---------------------|----------|------|
| Slot 1 | 11:30 | 圖文（可 reel） | 上午流量 |
| Slot 3 | 12:00 | 常為 Reel | 需 `docs/assets/<date>/slot-03.mp4`＋真實感目視 |
| Slot 2 | 20:30 | 圖文／Reel | 晚間；同日 catch-up 窗＝槽時起約 +4h（依 policy） |

Policy：`data/publishing-policy.json`（active 區間內才自動 live）。  
暫停：`PAUSED.json`（**禁止擅自清除**）。

---

## 3. 「單一輸入」／私享家版（取代貼房仲網址）

每一槽的輸入只允許下列之一（擇優）：

1. **日曆列已存在**：`data/content-calendar/<YYYY-MM-DD>.json` 該 slot 的 `topic`／`media_type`／路徑欄  
2. **Reel job 資料夾**：`output/reel-v3/<date>/job.json`（靴子標準 `reel-v3-character`）  
3. **內部來源適配（可選下一刀）**：Drive／Vault 一篇「主題卡」→ 寫入日曆（**不是**爬外部社團）

**輸出契約（發佈前必須齊）：**

- 圖：`docs/assets/<date>/slot-0N.png`（＋ webp 若產線有）  
- Reel：`docs/assets/<date>/slot-0N.mp4`＋`*.mp4.audio.json`（若有音軌）  
- 公開 URL 可 HEAD 200：`https://sixiangjialaundry.com/assets/<date>/slot-0N.(png|mp4)`  
- 文案：日曆 caption／品牌開示 `AI情境示意`／CTA＝LINE 評估＋誠實價帶  

---

## 4. 每日流水線（可勾選）

### 早上｜產與補洞

```powershell
$root = 'C:\Users\cyc39\Documents\New project 5'
Set-Location -LiteralPath $root
npm.cmd run pause -- --status
# 需要產日曆／補洞時：
# powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\daily-generate.ps1 -Date YYYY-MM-DD
```

- [ ] Policy active、未 PAUSED  
- [ ] 今日三槽主題存在  
- [ ] Slot 缺 mp4／png 者標紅（**缺就不進核准**）

### Reel 日｜靴子標準＋真實感閘

1. Job：`output/reel-v3/<date>/`（style_lock＝`leather-boot-mould@2026-09-14`）  
2. `python scripts/reel-v3/produce_day.py output/reel-v3/<date>`  
3. 配線：`master-candidate.mp4` → `docs/assets/<date>/slot-0N.mp4`（含 audio sidecar）  
4. **指揮席整片目視**（真實感：不一眼 AI、順暢、光影像實拍）  
5. 通過才：`npm.cmd run owner-video-review -- --date YYYY-MM-DD --slot N --watched`  
6. **禁止**偽造 Grok+Sol／未看就 `--watched`

### 核准

```powershell
npm.cmd run auto-approve -- --date YYYY-MM-DD
# 報告：output\operations\auto-approve-<date>.json
```

- [ ] 僅核准「媒體齊＋（Reel 已 watched）」之槽  
- [ ] 缺片槽留 pending，不當日硬發圖頂替 Reel（preflight 會拒）

### 公開站（Reel／新圖必做）

```powershell
npm.cmd run generate-public-site -- --date YYYY-MM-DD
npm.cmd run publish-pages -- --date YYYY-MM-DD --skip-audit
# 等 GitHub Pages deploy 成功後再 HEAD 公開 URL
```

### 發佈（官方）

```powershell
# Prefight
npm.cmd run post-current-slot -- --date YYYY-MM-DD --slot N --dry-run --preflight-only --skip-url-check
# 同日補發（policy 內）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\catchup-publish.ps1
# 或觸發既有 Publish-1130 / 1200 / 2030 / Sentinel 任務
```

- [ ] 只在槽窗或 same_day_catch_up 內  
- [ ] 證據只認 `data/posted-log/<date>.json`  

### 晚上｜2035 狀態（遠端狀態替代 App）

指揮席／routine 回報：

| 槽 | 核准 | 已發 FB | 已發 IG | 阻斷原因 |
|----|------|---------|---------|----------|
| 1 | | | | |
| 3 | | | | |
| 2 | | | | |

指令備援：

```powershell
Get-Content data\posted-log\YYYY-MM-DD.json -Raw
Get-Content data\approved-log\YYYY-MM-DD.json -Raw
schtasks /Query /FO TABLE | findstr /I Laundry
```

---

## 5. 隊列狀態機（私享家版「間隔」）

不做 30–60 分隨機刷文。改用：

| 狀態 | 定義 | 動作 |
|------|------|------|
| `DRAFT` | 日曆有、媒體缺 | 產圖／產片；不核准 |
| `READY` | 媒體齊、公開 URL 可達（Reel 另需 watched） | 可 auto-approve |
| `APPROVED` | 在 approved-log | 等槽窗／catch-up |
| `LIVE` | posted-log success、非 dry_run | 記 post_id |
| `BLOCKED` | 門檻／404／PAUSED／過窗 | 寫原因；過窗不跨日 backfill（除非老闆授權） |
| `HELD` | 真實感不合格／老闆叫停 | 重產或留空，不偽造 |

---

## 6. 生命週期（合法版）

| 事件 | 做法 |
|------|------|
| 當日停發 | 設／保留 `PAUSED.json`（人下令） |
| Policy 過期 | 自動 live 停止；改人工問 |
| 錯文下架 | **老闆授權**後走 Meta 官方刪／藏；留審計 |
| N 天自動刪貼 | **尚未產品化**；若要另開規格（官方 API＋審計），不做桌面點刪 |
| Reel 風格 | 鎖靴子標準；一眼 AI＝不合格重做 |

---

## 7. 文案／CTA 最低標（洗衣店）

每則對外必須具備：

1. 真實情境痛點（材質／濕氣／錯誤 DIY）  
2. 神話破除一句  
3. 判斷標準（何時該送洗）  
4. CTA：拍關鍵部位 → **LINE 私享家**先看  
5. 誠實價帶（對 `data/prices.json`，勿混報）  
6. 開示：`AI情境示意`（AI 產視覺時）  
7. 品牌：`私享家洗衣店`

---

## 8. 每週加碼（輕量，可併 SEO 席）

- **週一 15 分 GSC**：位次 4–20 改標題；衰退頁刷新；高曝光低 CTR  
- **GBP**：貼文 1–2／週、回覆評價、照片更新  
- **槽主題預產**：D+1～D+3 缺片提前標紅（尤其 Slot2／3 Reel）

---

## 9. 與開源／商用工具怎麼疊（可選）

| 層 | 建議 | 不做 |
|----|------|------|
| 發佈執行 | **維持現有** catch-up／Meta API | Postiz／Mixpost 取代主幹（除非另開 IG／X 實驗） |
| 工作流編排 | n8n 可接「狀態通知」唯讀 | 用 n8n 打社團 |
| 垂直競品（EZup／快手／KingJoo） | 只參考 UX | 安裝來發粉絲專頁 |

---

## 10. 角色（多席）

| 席 | 一刀 |
|----|------|
| dr eggbot | 指揮、真實感目視、禁偽造、禁未授權 live |
| Codex | 架構／複審／作業包硬傷 |
| Hermes | 產線／長任務／腳本 |
| Grok | 僅 I2V 一刀 |
| 小潘 | 執行收斂、短證據 |
| SEO & AEO | GSC／關鍵字 brief，不發佈 |

---

## 11. 今晚若要「最小可用」

1. 對今日：填上表三槽狀態（2035 格式）  
2. 缺 `slot-02.mp4` 者：開 reel-v3 job 或改媒體類型（老闆決定）  
3. 有片未發：Pages 200 → catch-up  
4. 不開社團工具

---

**檔案位置（指揮席電腦）：**  
`/workspace/laundry-workflow/SIXIANGJIA-LAUNDRY-ONECLICK-OPS-20260923.md`  
**姐妹草圖：** `SIXIANGJIA-REUSABLE-FLOW-20260923.md`
