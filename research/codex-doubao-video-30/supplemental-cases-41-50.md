# Codex＋豆包／Seedance 影片製作補充案例 41–50

檢索日：2026-07-20（第三波，補 direct 數量缺口）  
狀態：`candidate_evidence_not_yet_accepted`  
規則：不把 API wrapper、awesome list、Claude-only skill 或 fork 鏡像算成「Codex＋豆包直接製片案例」；每案標出 Codex 證據、Seedance／豆包證據、產物鏈與限制。

## 本波新增直接候選（exact：同時明示 Codex 與 Seedance／豆包）

| ID | 專案／固定版本 | Codex 證據 | Seedance／豆包證據 | 可驗證產物鏈 | 可蒸餾方法 | 限制 |
|---|---|---|---|---|---|---|
| CSD-41 | [doubao-seedance-video-skill](https://github.com/a86582751/doubao-seedance-video-skill) `2b56c31b3e99f193933616c8afdd26a1a2e064fd` | Codex skill 安裝到 `~/.codex/skills`；`agents/`；完整 long-video 工作流以 Codex 為外層 | Volcano Ark Doubao Seedance 2.0 / Fast / Mini；`seedance_video.py` | storyboard → prompt 優化 → 生成 → 抽幀 subagent 審片 → regenerate／pickup → EDL → Seed Audio → FFmpeg → 成本報告 | **一次性 disposable subagent 審片**；**先鎖視覺 EDL 再做最終音軌**；生成前 resource-package preflight | 本機無公開成片 trace；需 Ark key 與 companion skills；作者路徑含本機帳號痕跡需忽略 |
| CSD-42 | [ai-GPT_Image2-Seedance_2.0-video-skills](https://github.com/AGI-Ruby/ai-GPT_Image2-Seedance_2.0-video-skills) `a41b4abafc826cb83c9f214a1371f4e68d2ee9f0` | 明示 Codex skills；`npx ... install --target codex`；`~/.codex/skills` | Seedance 2.0 video prompt 產出 | idea → GPT Image 2 storyboard prompt → Seedance video prompt → workflow notes | **storyboard prompt 與 video prompt 兩段式**；previs 與執行 prompt 分開 | 不呼叫影片 API；無 raw clip／QA |
| CSD-43 | [seedance-forge](https://github.com/StreetJammer/seedance-forge) `90962bd25d31c7cbd6c8ae5cbae6acd4d3a651eb` | Codex CLI 安裝到 `~/.codex/skills/seedance-forge`；README 有 `codex "..."` 範例 | 2,366 筆真實 Seedance 2.0 社群 prompt corpus | 讀 structure-guide → 搜尋 corpus → 抽取結構骨架 → 起草 prompt → 引用來源 | **用真實 corpus 學結構，不抄字面**；三種 archetype（散文／時間戳／bold header） | 參考庫不是生成器；非 Sora／Kling 通用 |
| CSD-44 | [hiapi-seedance-2-0-video-skill](https://github.com/HiAPIAI/hiapi-seedance-2-0-video-skill) `d68202dc674684b29ea0388edf921e7969613657` | `npx ... --codex` 安裝到 `~/.codex/skills` | Seedance 2.0 T2V／I2V via HiAPI；`scripts/hiapi-seedance-2-video.mjs` | prompt／first-frame → create task → poll → download → outputs | Agent 可執行 T2V／I2V／first-last／multimodal reference；錯誤碼對應下一步 | 偏 API skill，弱劇作／剪輯；供應商路由需另驗 |
| CSD-45 | [seedance-video-pet](https://github.com/chenmisss/seedance-video-pet) `9215924e28045825d354d1dbaedaa1f0db71d779` | Codex skill `SKILL.md`＋`agents/` | Seedance／Ark action-pack 生成 | action pack → payload → Ark task poll → QA → React chroma-key 整合 | **動作包規格化**；固定相機／綠幕／迴圈起迄；前端狀態機與生成分離 | 桌寵／產品 UI 場景，不是商業敘事短片 |
| CSD-46 | [seedance2-api / seed2-video skill](https://github.com/xuliang2024/seedance2-api) `4b2593197d42a431e05bc006f50213a05d4c9839` | 明示 Codex skill 安裝腳本到 `~/.codex/skills/seed2-video` | Seedance 2.0 Mini／Fast／VIP via Seed2.io | model 選擇 → payload → poll → video URL | **依成本／速度分 tier**；reference 別名正規化 | 以 API／skill 為主；無完整劇作／剪輯系統 |
| CSD-47 | 升級重標：[VibeFrame](https://github.com/vericontext/vibeframe) `7da2085c760986f11375adf19ac92807504d58c9`（原 CSD-31） | README 明示 Codex outer-loop、Codex prompt、`vibe host setup codex` | Seedance 作 I2V／video provider | brief → STORYBOARD／DESIGN → dry-run／cost gate → keyframe 審 → I2V → inspect／repair → MP4 | **host agent（Codex）與 video CLI 分離**；`--skip-video` 先審 keyframe；character sheet 跨 beat | 多 provider；不是 Codex-only；成片 showcase 的 Seedance provenance 仍需逐檔驗證 |

## 本波檢過但不計入 direct

| 來源 | 原因 |
|---|---|
| `op7418/Seedance-Product-Video` | Claude Code skill；未明示 Codex |
| `robonuggets/seedance-skill` | Claude Code／Fal 產品片；未明示 Codex 為主路徑 |
| `LeoYeAI/seedance-skills` | Emily2040/seedance-2.0 的 OpenClaw 再包裝（已有 CSD-06） |
| `Evolink-AI/seedance-2-family-video-gen-skill` | OpenClaw／Claude／OpenCode；相容表無 Codex |
| `Anil-matcha/Seedance-2-API`、`amrrs/seedance-2.0-api` | 純 API wrapper |
| `ZeroLu/awesome-seedance` | awesome list，非製片案例 |
| `a86582751/doubao-seedream-image-skill`、`doubao-seed-audio-skill`、`volcengine-resource-query-skill` | CSD-41 companion；圖像／音訊／帳單，不單獨計影片案例 |

## 計數更新（已被獨立反向稽核修正）

| 指標 | 前一輪 | 本輪後 | 備註 |
|---|---:|---:|---|
| 去重候選總數 | 40 | **47**（CSD-01～47；CSD-47 為 CSD-31 升級重標，不雙計時以 46 unique repos 計） | unique 本體以 repo／文章為準 |
| **Codex＋豆包／Seedance 直接組合（exact）** | 原記錄約14 | **此數字作廢** | 獨立稽核發現 CSD-01～14 嚴格 direct 只有6；本表各案仍須逐案套用同一標準，不能直接相加 |
| 距離使用者要求的 30 個 direct | 原記錄缺16 | **本波結束時仍缺9案；現已由CSD-61～69補齊** | 此列為歷史快照；目前正式數字為30 direct、4 executed，詳見正式稽核檔 |
| accepted／本機重現 | 0 | 0 | 仍全部是 candidate |

> 更正：先前「20–21 direct」把相容 skill、API 路線與未執行前製混在同一分母，已撤回。正式口徑見 `direct-case-adversarial-audit-2026-07-20.md`。

## 本波新蒸餾（待私享家 fixture 驗證）

1. **視覺先鎖、聲音後建**：長片預設先做 visual EDL，再從「初始分鏡＋edit facts」重建 `final_storyboard_for_audio`（CSD-41）。
2. **Disposable subagent 審片**：主線不塞 contact sheet；每段與最終組接各開一次用完即棄的審片子代理（CSD-41）。
3. **資源包 preflight 只在付費生成前**：粗估與分鏡迭代不查餘額；shot plan 鎖定後、第一筆付費前再查（CSD-41）。
4. **Keyframe 便宜審、I2V 貴生成**：`--skip-video` 先過靜態板再付費動畫（CSD-47）。
5. **Character sheet 一次、跨 beat 重用**：人物 identity 不在每鏡重發明（CSD-47）。
6. **Prompt 結構來自 corpus，不是模板空想**：搜真實 Seedance prompt 骨架再填本案（CSD-43）。
7. **Storyboard prompt ≠ video prompt**：圖像分鏡與 Seedance 執行提示分技能、分輸出（CSD-42）。

## 搜尋盲點（解釋為何仍不足 30）

- 公開 GitHub 上「同時」寫明 Codex **且** 豆包／Seedance **且** 有完整劇作→生成→剪輯的案例，本身稀少；大量是 Claude-only skill 或 API wrapper。
- 許多「Codex skill」只教寫 prompt，沒有 runtime；可計 exact-preproduction，但若使用者定義「做影片」要求 runtime，有效 direct 更少。
- 非 GitHub 的付費社群、私密工作流、中國大陸封閉社群案例無法在 secret-free 條件下納入。
- 不得用 adjacent runtime（Claude／OpenClaw／n8n）改標 exact 來補數。

## 下一波建議搜尋軸

1. 中文關鍵字：`Codex` + `即夢` + `Seedance` + `短劇`／`分鏡`／`Ark`。
2. GitHub topics：`codex-skill` ∩ `seedance`。
3. 創作者文章／note／小紅書公開長文（需固定抓取日與 hash）。
4. 學術 agent harness 若同時使用 Codex 與 Seedance（如 VideoWeaver 系擴展）。
5. 任何新 exact 必須帶 commit SHA 與檔案級 locator，否則只進候選池不進 direct 計數。
