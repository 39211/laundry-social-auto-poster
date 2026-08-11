# CSD-61～69：30案補齊稽核

查核日：2026-07-20  
狀態：`candidate_audit_not_accepted_knowledge_pack`  
口徑：同一來源必須同時證明 OpenAI Codex 專屬入口，以及 Codex 產物進入豆包／Seedance 製片鏈。沒有同一次 provider 任務回執者，一律不得標為 `direct-executed`。

| ID | 固定來源 | 分類 | 可核對的製片鏈 | 限制 |
|---|---|---|---|---|
| CSD-61 | [OpenMontage `80e045a`](https://github.com/calesthio/OpenMontage/commit/80e045a1e78ad41b6ebb83ce0f94444ea39224a2) | `direct-runnable` | Codex 入口 → research／劇本／scene → Seedance provider → edit／compose → review／publish gate | 展示片沒有同一 run 的 Codex session 與 Seedance request ID |
| CSD-62 | [video-podcast-maker `3036303`](https://github.com/Agents365-ai/video-podcast-maker/commit/3036303733200f42624df1d4c1a19a28d760f738) | `direct-runnable` | Codex `AGENTS.md` → 研究／劇本 → 豆包 TTS → timing → Remotion／FFmpeg → ffprobe 驗收 | 無公開 Codex session、豆包 receipt 與對應 final MP4 |
| CSD-63 | [higgsfield-ai/skills `9ab6483`](https://github.com/higgsfield-ai/skills/commit/9ab6483d45ebead2c0cf7597ae96ab3eb605fa34) | `direct-runnable` | `.codex-plugin` → 品牌廣告 brief／產品與人物資產 → Seedance 2.0／Marketing Studio → 完成影片評分 | 無公開 job receipt；第三方服務內部剪輯不透明 |
| CSD-64 | [video-distillation `2254a3e`](https://github.com/stopbye/video-distillation/commit/2254a3eed294abc241c863bb0c27ec56817fca97) | `direct-preproduction` | Codex 讀片 → 角色／場景／連續時間軸／動作／聲音蒸餾 → 豆包 I2V prompt 包 | 刻意不提交或生成影片，不能升格 runnable |
| CSD-65 | [paper-cut-video-skill `0ff209f`](https://github.com/crawfordxx/paper-cut-video-skill/commit/0ff209fd72648d6eb1b2315308c19d50b74c74f9) | `direct-runnable` | Codex skill → 劇本／角色／圖層 → 豆包 TTS 字詞時間 → Remotion → H.264／AAC → contact sheet QA | repo 有 demo，但無同一 run 的 Codex／豆包 provider receipt，保守降級 |
| CSD-66 | [codex-dreamina-video-studio `6198537`](https://github.com/baitalab/codex-dreamina-video-studio/commit/61985374957fcfdb47124fc056b07d012aa4bc19) | `direct-runnable` | Codex → 劇本／角色 bible／shot manifest → Dreamina submit／poll → rough cut／SRT／stems → QA | 無公開真提交回執或對應成片 |
| CSD-67 | [ai-feed-ad-skill `3beb157`](https://github.com/huangbai-AI/ai-feed-ad-skill/commit/3beb157bb35f59eb03321bfda5468e713e223864) | `direct-runnable` | Codex 分析真產品 reference → 招客劇本／分鏡 → Dreamina／Seedance task → quality loop | 無 checked-in generated video；VIP／額度失敗會停機 |
| CSD-68 | [video-pipeline-skill `c92da75`](https://github.com/Jacky-Chen-Pro/video-pipeline-skill/commit/c92da7550f8aeb7b1ec4dae1fcdfeb889b4b210b) | `direct-runnable` | Codex → research／劇本／風格 → TTS 實測 → storyboard／keyframe → Seedance task／tail frame → captions／剪映草稿／驗證 | 無同一 run 的 provider receipt；需人工核准與外部服務 |
| CSD-69 | [script-to-seedance-workflow `e8504b2`](https://github.com/marvinsummer/script-to-seedance-workflow/commit/e8504b21dc8b5d9ab0e6d311a813b447da1fb208) | `direct-runnable` | Codex 劇本 → 角色／場景 → Dreamina 圖片 → Seedance 多模態測試／submit ID 紀錄 | 公開內容是可執行工作流，不是完整私享家成片重現 |

## 補齊後的嚴格計數

- direct：**30**（原21＋本表9）。
- `direct-executed`：**4**。
- `direct-runnable`：**19**。
- `direct-preproduction`：**7**。
- accepted／本機重現：**0**。

達成的是「30個去重 direct 研究案例」，不是30支已跑通影片，也不是私享家生成授權。研究包仍在 quarantine；`SCRIPT_LOCK`、`FIRST_FRAME_RENDER_TOKEN`、`VIDEO_GENERATION_TOKEN` 全部維持關閉。

## 對私享家劇本與導演最有用的新增蒸餾

1. 招客片先鎖客群、顧客損失、可相信的證據與單一 CTA，再拆鏡；不能由生成秒數反推故事。
2. TTS／真人走戲的實測時間是剪輯主時鐘；Seedance 最小輸出長度只決定 raw take，不決定成片鏡長。
3. 每支 raw clip 只交付一個可觀察動作；劇情因果、清潔判斷、Logo、字幕與 CTA 留在劇本或確定性後製。
4. 先審劇本、角色／物件 bible、靜態 keyframe，再提交付費 I2V；已接受 take 的尾幀才是下一鏡連戲起點。
5. 讀片蒸餾必須記錄前態→接觸→後態，以及 POV、對白、旁白與環境聲；讀不到的內容不得補想像。
6. 招客片要保留真實物件與真實工序的證據地位；AI reference 只能做預演，不能冒充私享家案例或 before／after。
