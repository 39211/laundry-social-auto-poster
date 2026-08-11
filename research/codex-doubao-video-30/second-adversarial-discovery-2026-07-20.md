# 第二批創作者與 GitHub direct 候選

日期：2026-07-20  
狀態：`discovered_pending_same-standard_adversarial_audit`  
用途：保存第二波可追溯候選。兩位獨立稽核已裁決其中12案為direct；正式穩定ID、等級與總數以 `direct-case-adversarial-audit-2026-07-20.md` 為準。

## 有公開影片／展示的創作者候選

| 候選 | 直接來源與定位 | 可驗證鏈 | 尚缺 |
|---|---|---|---|
| FeicaiClub | [38:22 YouTube](https://www.youtube.com/watch?v=yQjGNLYw2vs)：`01:47`架構、`08:01`劇本、`12:39`服化道、`14:29`故事板、`19:56`批量圖聲、`23:03–31:24`出片剪輯 | 標題／說明明示Codex導演＋Seedance，並展示成片 | task ID、raw、工程、hash與失敗take ledger |
| 煙花老師 | [X原帖](https://x.com/teach_fireworks/status/2076332043156475926)／[39秒final](https://youtube.com/shorts/AHtwSodHy_k) | Codex＋Imagen鎖資產→三組Seedance→FFmpeg重排／字幕／響度 | manifest、指令、raw 51秒與響度報告 |
| 探路AI | [X原帖與30.4秒影片](https://x.com/TanLuAI/status/2075534714145067464) | Codex故事板圖→兩段Seedance→拼接 | Codex專屬入口、音訊、task、候選take與QA |
| RalfNick | [X原帖與15.104秒影片](https://x.com/Ralf_Nick1/status/2073749057466724452) | Codex整理規格→15秒逐秒分鏡→manifest→Ark submit/poll/download→ffprobe→contact sheet | manifest、request與machine report未公開 |
| Victor Freitas | [X原帖與兩支約15秒影片](https://x.com/victorpfreitas/status/2076790730186539235) | Codex 5.6 Sol＋Blender MCP reference→Seedance→rendered outputs | Codex／Seedance machine trace、scene、prompt、request與QA |
| SeeReel | [`efa7d4e` README L27–61、L101–108、L370–390](https://github.com/feifeibear/SeeReel/blob/efa7d4e165f48641013eaa6e0310f1a312dfa097/README.md#L27-L61) | Codex chat→storyboard nodes→兩個15秒shots；shot1 tail asset成shot2 first-frame→30.167秒MP4 | cloud session不是完整provider response archive |

## 固定 commit 的 runtime／前製候選

| 候選／固定版本 | 主要 locator | 暫定層級與限制 |
|---|---|---|
| [doubao-seedance-video-skill `2b56c31`](https://github.com/a86582751/doubao-seedance-video-skill/commit/2b56c31b3e99f193933616c8afdd26a1a2e064fd) | README L1–55、L80–94；`seedance_video.py` L399–455、L787–804；`video_review_tools.py` L334–388 | 完整劇本→storyboard→candidate→逐格 review→EDL→audio→FFmpeg runtime；公開包明示不含generated videos |
| [AGI-Ruby `a41b4ab`](https://github.com/AGI-Ruby/ai-GPT_Image2-Seedance_2.0-video-skills/commit/a41b4abafc826cb83c9f214a1371f4e68d2ee9f0) | README L1–47、L103–166、L183–210 | 兩階段前製；明示不呼叫video API |
| [ai-image-master `19b0a32`](https://github.com/2799662352/ai-image-master/commit/19b0a32ebf29e02ac5d1eeaa2b205beff72a7c06) | README L42–50；Seedance skill L2–6、L58；`taskManager.ts` L225–274；`runtime.ts` L295–350；tests L93–151 | Codex runtime＋submit/poll/download與mocked state tests；無公開真provider receipt |
| [imagine-campaign-director `f4a7db4`](https://github.com/Vyro-ai/imagine-campaign-director/commit/f4a7db48167d1280a58ab06bd35392d1f769571f) | README L3–11；AGENTS L25–43、L55–66；Seedance guide L7–23 | Codex treatment→image-grounded Seedance→ffprobe／manifest→HyperFrames；依賴瀏覽器登入與credits，無run receipt |
| [superVideoGenarateFactory `9a55438`](https://github.com/alyunzhangu/superVideoGenarateFactory/commit/9a55438f59a624daa08e2ca98351700db006ba9c) | README L3–9；`seedance_submit.py` L321–370；audio tests L56–100 | Codex拆鏡／九宮格→Ark submit/poll/download；只有dry-run／unit test，無付費真run |
| [capsule-cinema `5315a59`](https://github.com/JuneYaooo/capsule-cinema/commit/5315a59d47eab80f129fb3f98551e12553ef61be) | README L39–48、L76、L95–178、L196–232、L315–323；Ark adapter L273–316、L354–415 | Codex→分鏡批准→Seedream／Seedance／豆包語音→FFmpeg；README內嵌成片，provider provenance仍待逐片核對 |
| [MythoFrame-AI `f725196`](https://github.com/LingFengJ/MythoFrame-AI/commit/f72519685195880c7ad26a6fb3e44e76604c69ce) | README L62–121、L175–176、L232–312；tests L464–481、L529–575、L598–621 | `codex_web`→shot/storyboard→Dreamina Seedance→rough cut／review；browser automation first，無checked-in真成片 |
| [lianhuanhua-skills `244675a`](https://github.com/littlewindy123/lianhuanhua-skills/commit/244675ac1645765e08ac7395d0e0c32fcaf7af8b) | README L3–19；SKILL L8–20、L81–91、L320–355；renderer tests L14–60 | Codex導演／分鏡＋豆包TTS＋FFmpeg final；可重現，但明示不是生成式動態影片 |
| [plotloom `eb7bc85`](https://github.com/T0UGH/plotloom/commit/eb7bc856058d1a97a1a6a5640accdc238e4efc64) | README L12–47、L156–183、L406–408；Seedance adapter L12–31、L56–117；tests L33–75、L141–186 | Codex images→Dreamina／Seedance→selection／stitch／subtitle；fake HTTP test，無真provider receipt |
| [video-podcast-maker `3036303`](https://github.com/Agents365-ai/video-podcast-maker/commit/3036303733200f42624df1d4c1a19a28d760f738) | README L15–21、L32–43、L104–117 | Codex-compatible SKILL；research→單一劇本→豆包TTS→timing→Remotion／FFmpeg；相容列表未必等於Codex執行證據 |
| [open-design `6b90486`](https://github.com/nexu-io/open-design/commit/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf) | README L34–38、L112–137、L233–254、L266–269 | 明示Codex runtime、Seedance prompt庫與HyperFrames MP4；尚無同一session把Seedance clips接成成片的trace |
| [video-editing-skill `79bbc4d`](https://github.com/maxazure/video-editing-skill/commit/79bbc4d2cf9e527363f1c18336fa767c29ebe368) | README L1–29、L35–74、L81–97 | Codex editorial pipeline＋Dreamina approval route；可選素材路線不等於已生成影片 |

## 暫時蒸餾、不先改劇本的經驗

1. 上一鏡的驗收尾幀要登記為下一鏡首幀資產，不靠重複提示詞維持連戲。
2. 社群影片若只有作者口述，保留其方法但降低證據級別；不能把口述task流程當machine receipt。
3. 公開成片、真provider runtime、mock測試與前製handoff必須分四欄記錄。
4. 私享家現階段只吸收「故事批准、資產批准、單鏡缺陷修復、逐格QA」；不開生成token。
