# Reel v2 — Codex-style three-shot reel

2026-09-08 老闆讓 Codex 獨立做 9/8–9/10 三支 Reel 直接上架比較,判定比 v1(`produce-next-reel.ps1`)好。
本目錄把那套做法搬進產線;素材與 QA 證據正本在 `output/codex-comparison-20260908-0910/`。

## 規格(與 Codex 成片一致)

| 項目 | 規格 |
|---|---|
| 生成 | grok-imagine-video-1.5,`resolution 1080p`、`9:16`、每鏡 7 秒,hermes xai-oauth(不走計費 key) |
| 鏡頭 | 每鏡**只有一個**極克制運鏡(3° tilt / 4–8 cm 推移 / 100→97% 退),物件絕對靜止;不演工序、不碰物件 |
| 場景 | 客人家(物件在原位),乾淨牆面與地板,單側窗光;不是店內櫃台 |
| 結構 | 3 鏡各 7 s → 末鏡停格 2 s → 尾卡 3 s,約 26 s;旁白 80–90 字、正常語速、須在尾卡前結束 |
| 疊字 | 左上品牌常駐、「AI情境示意」揭露、每鏡一張兩行摘要字卡、尾卡 CTA+免費收送(`overlays.ass` 四樣式) |
| 音 | loudnorm I=-16 TP=-1.5 LRA=11;成片實測 −16 ± 1 LUFS |
| 封裝 | 1080×1920 24fps libx264 crf18 slow,AAC 192k 48k,faststart |
| 品管 | 每鏡 manifest 不可變(sha 釘在 jobs/);拒收留 `shot-XX-vN-rejection.json` 再出 v(N+1);成片 receipt(解碼、探針、響度、縮圖網格、hash) |

## 流程

```
job/
  job.json                 # narration, shot_summaries, tail_lines, shots[], voice, brand, disclosure
  shot-01-anchor.png       # gen_anchor.py (Codex gpt-image-2),導演先看
  shot-01.json ...         # generate_shot.py 契約:generation_id/input_image/output_file/duration_seconds/prompt
  shot-01-raw.mp4 ...      # 生成原片(不可覆寫)
  narration.mp3            # make_narration.py(MiniMax m5-warm-bestie,fallback edge-tts)
  master-candidate.mp4     # build_master.py
  qa/receipt.json, grid.png
```

1. `python gen_anchor.py <job> shot-01-anchor "<photoreal prompt>"`(同一時間只准一條 Codex 生圖)
2. 導演看首幀(有 logo/條紋/多物件就重生)
3. `python generate_shot.py <job>/shot-01.json`(三鏡可並行)
4. 抽縮圖審每鏡:有手碰物件、物件數變化、變白變乾淨 → 寫 rejection、出 v2
5. `python make_narration.py <job>`
6. `python build_master.py <job>` → 看 `qa/grid.png`、`qa/receipt.json`
7. 老闆看片 → `owner-video-review --watched` → 進 docs/assets/<date>/slot-03.mp4

## 提示詞骨架(每鏡)

`One continuous seven-second photorealistic native1080p portrait9:16 shot. Begin exactly from the reference frame. Preserve exactly this ONE <物件護照>. <唯一運鏡,含公分/角度/比例>. <物件絕對靜止、光線不變>. No hand, person, new object, cleaning transformation, whitening, texture drift, text, logo, cut, music or dialogue. Quiet indoor room tone.`
