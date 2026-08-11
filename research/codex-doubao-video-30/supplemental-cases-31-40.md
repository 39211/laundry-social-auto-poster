# Codex＋豆包／Seedance 影片製作補充案例 31–40

檢索日：2026-07-20  
狀態：`candidate_evidence_not_yet_accepted`  
規則：不把 API 包裝器、README 宣稱或提示詞集合等同「做完影片」；每案都標出實際產物鏈與限制。

| ID | 專案／固定版本 | 可驗證的產物鏈 | 可蒸餾方法 | 證據強度與限制 |
|---|---|---|---|---|
| CSD-31 | [VibeFrame](https://github.com/vericontext/vibeframe) `7da2085c760986f11375adf19ac92807504d58c9` | brief → `STORYBOARD.md` → `DESIGN.md` → dry-run/cost gate → Seedance I2V → render → inspect/review report → per-beat repair | 先鎖故事與設計；昂貴生成前先估成本；壞鏡只修該 beat | **強候選／Codex-compatible runtime**。仍需外部模型供應商；可執行能力不等於每個案例皆有成片品質證據。 |
| CSD-32 | [ArcReel](https://github.com/ArcReel/ArcReel) `9c94036dc7c3d61ce5277d28a30ec539bd25d612` | 小說 → screenplay → character/clue state → storyboard → Seedance clips → FFmpeg／CapCut | 長故事先建角色與線索狀態；agent 之間保留確認點與失敗狀態 | **強候選／相鄰多 Agent runtime**。不是 Codex 專用；需另驗 provider 與端到端樣片。 |
| CSD-33 | [Huobao Drama](https://github.com/chatfire-AI/huobao-drama) `ad1cd7cd0127389ce8304aa9ebda3cfc8f406a6d` | script → character/scene agents → storyboard → Seedance → TTS → FFmpeg | 劇本、角色、場景、分鏡分開交付；聲音與畫面在後段組合 | **強候選／相鄰多 Agent runtime**。5 個 Mastra agents，不是 Codex；品質 gate 需另驗。 |
| CSD-34 | [Pilipili-AutoVideo](https://github.com/OpenDemon/Pilipili-AutoVideo) `95b93df5af30d93f30aa29100270aa24b5563f5b` | 一句主題 → 反思式結構化分鏡 → keyframes＋TTS duration → Seedance/Kling I2V → FFmpeg＋字幕 → CapCut draft | 先用 TTS 實測時間再定鏡長；分鏡可經反思回路修訂 | **強候選／相鄰 runtime**。需逐檔確認 README 與實作一致；不把 CapCut draft 當發布成片。 |
| CSD-35 | [shortdrama-pipeline](https://github.com/drasstry/shortdrama-pipeline) `de4c1365adcf101a871965210422b206cbc2048f` | theme → script → 人工劇本批准 → characters → 人工角色批准 → shots → FFmpeg final | 明確 approve/reject/regenerate；只有 accepted assets 進 `latest`；fake mode 與真實執行分離 | **強候選／可重現 runtime**。script QC 為 warning-only，不能代替人工劇作審查。 |
| CSD-36 | [daihuo-jianshou](https://github.com/xixihhhh/daihuo-jianshou) `e5df82dd0e672b6c95e56cf136e9fe5b2c44a46c` | product image → selling-point copy → shot assets → Seedance 1.5/other video → FFmpeg → captions/TTS | 真實產品近拍優先於 AI 人臉；商品證據與人物表演分層 | **條件候選／電商 runtime**。README roadmap 與完成項需分開；作者經驗不是普遍實驗結論。 |
| CSD-37 | [OpenSwarm](https://github.com/VRSEN/OpenSwarm) `574b825965dafed9ba02faeeb9c4db73a0b218ef` | customizable agents → video-generation agent → Seedance provider → output artifact | 角色能力明列，執行 agent 不兼任審核 | **相鄰候選**。通用 agent runtime，不是完整影片劇作／剪輯案例；只蒸餾編制。 |
| CSD-38 | [AiToEarn](https://github.com/yikart/AiToEarn) `e48981ec9e0469cfdad64bc1666bd3256f126a57` | social-content workflow → Doubao video support → output management | 平台內容、生成與發布資產分開管理 | **弱候選**。需再證明 Doubao 路徑、剪輯與 QA 的精確檔案；不得列 exact production case。 |
| CSD-39 | [Video Explainer](https://github.com/prajwal-y/video_explainer) `c033e28d6eccae43c1762f4653f9c320b16b050e` | document → script → TTS＋word timestamps → storyboard/animation → final video | 聲音先實測、畫面依語意與字詞時間派生；字幕與排版留本地 | **相鄰可重現候選**。非 Seedance；只蒸餾時間軸與可重現後製。 |
| CSD-40 | [DramaDirector](https://github.com/iLearn-Lab/DramaDirector) `166633ec1502326c12af103c1de4019106a944dc`／[論文](https://arxiv.org/abs/2606.24107) | screenplay → structured storyboard → static geometry condition → dynamic narrative condition → keyframe → I2V | 把站位、視線、遮擋、深度等靜態幾何與動作、運鏡等動態敘事分離 | **學術候選**。遵守研究限制與授權；不能把 benchmark 外推成私享家成片保證。 |

## 這十案改變了什麼

1. **劇本先批准**：不從題材直接跳生成；角色與物件資產也各有批准點。
2. **每鏡雙層規格**：先寫靜態幾何／連戲狀態，再寫單一主要動作。
3. **聲音量測先於片長**：鎖文案、正常語速 TTS、量測後才分配鏡長；模型最小片段不反推劇本。
4. **候選 take 與 accepted footage 分離**：只有人工與機器 QA 都通過的 clip 才能成為下一鏡 continuity 依據。
5. **單變數重做**：一個 defect 對一個修訂，不同時換人物、鏡位、光線、動作與節奏。
6. **AI 只負責不確定的動態**：Logo、字幕、CTA、手機 UI、聲音、時間碼與版面留給確定性後製。

## 不採用的捷徑

- 只有 create/poll/download 的 API wrapper，不算影片製作經驗。
- 只有 prompt gallery，沒有版本、產物鏈或驗收，不算完成案例。
- repo 內有 MP4，不代表該 MP4 由宣稱流程產生；缺 generation log 時只能列示例。
- 星數、README 更新或社群熱度不是畫面品質證據。

