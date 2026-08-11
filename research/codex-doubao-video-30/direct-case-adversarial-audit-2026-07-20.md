# Codex＋豆包／Seedance direct 案例獨立反向稽核

日期：2026-07-20  
狀態：`candidate_audit_not_accepted_knowledge_pack`  
目的：阻止把「Codex相容」「Prompt工具」「API wrapper」或「Seedance展示」灌成Codex實際製片案例。

## 嚴格定義

同一個公開來源必須同時證明：

1. 明示 **OpenAI Codex**，不是泛稱coding agent、AGENTS.md、Copilot或codex-style。
2. 有Codex專屬入口或角色證據，例如Codex CLI／Desktop命令、`.codex`安裝或harness設定。
3. 能定位Codex產物如何進入豆包／Seedance製片鏈。
4. 純create／poll／download wrapper、prompt gallery、awesome list與只有相容平台表者不算direct-film。
5. `direct-executed`、`direct-runnable`、`direct-preproduction`分開，不互相冒充成片。

## CSD-01～14重算

| 等級 | ID | 判定 |
|---|---|---|
| `direct-executed` | CSD-12、13、14 | 分別為研究執行、vendor demo與creator case；有執行／展示證據，但都不是私享家商業片重現 |
| `direct-runnable` | CSD-01、03 | Codex專屬入口接Seedance runtime；未公開真provider成片或真run receipt |
| `direct-preproduction` | CSD-05 | Codex Desktop專用storyboard package；只交付Seedance prompt，不呼叫video API |
| `excluded_from_direct` | CSD-02、04、06、07、08、09、10、11 | 只證相容、泛Agent、prompt工具、Claude-primary或外部展示，缺Codex實際鏈 |

因此舊口徑「約14 direct」錯誤；嚴格口徑為 **6 direct，其中executed只有3**。

## 新增且已套用同一標準

| 來源／固定版本 | 等級 | 精確證據與限制 |
|---|---|---|
| CSD-48 [ZeroLu/Ultimate-AI-Media-Generator-Skill `34dda10`](https://github.com/ZeroLu/Ultimate-AI-Media-Generator-Skill/commit/34dda1066245d861f95b67e1fc75f0c93b60d5f6) | `direct-runnable` | README L30–64、L95–104；CLI generate-video／task／finalize；comic-drama workflow具scene plan。泛媒體bundle，無單一成片trace。 |
| CSD-49 [HiAPIAI/hiapi-video-prompt-generator-skill `bb5fb2d`](https://github.com/HiAPIAI/hiapi-video-prompt-generator-skill/commit/bb5fb2da21dbf02e80515eac0a33bd66aa848576) | `direct-preproduction` | README L44–58、L101–121、L173–186；明示不呼叫API，只交handoff command。 |
| CSD-50 [gregoramon/aiexpert-skills `12cc668`](https://github.com/gregoramon/aiexpert-skills/commit/12cc6681916a2e58dd0cb847e0d076689956de29) | `direct-preproduction` | README L33–46、L73、L79–86、L114；Codex CLI安裝後輸出貼往Seedance，沒有runtime／成片。 |

另拒絕 CSD-44 `hiapi-seedance-2-0-video-skill` 與 `seedance-2-mcp`（只有create／poll／download，缺劇作、選片、剪輯與QA鏈）、`PiAPI-Skills`（泛multi-provider）、`seedance-ip-pipeline`（混稱GitHub Codex／Copilot）、`seedance-2-generator`（無OpenAI Codex證據）。

## 第二位對抗稽核通過的12案

| ID／固定版本 | 等級 | 為何通過；限制 |
|---|---|---|
| CSD-51 [SeeReel `efa7d4e`](https://github.com/feifeibear/SeeReel/commit/efa7d4e165f48641013eaa6e0310f1a312dfa097) | `direct-executed` | `--agent codex`專屬安裝、可定位Codex session回覆、兩個Seedance shot、tail-frame continuity、30.167秒final；cloud session不是完整provider archive。 |
| CSD-41 [doubao-seedance-video-skill `2b56c31`](https://github.com/a86582751/doubao-seedance-video-skill/commit/2b56c31b3e99f193933616c8afdd26a1a2e064fd) | `direct-runnable` | OpenAI Codex skill→storyboard→Seedance clips→獨立QA→EDL→Seed Audio→FFmpeg；公開包不附generated videos。 |
| CSD-42 [AGI-Ruby `a41b4ab`](https://github.com/AGI-Ruby/ai-GPT_Image2-Seedance_2.0-video-skills/commit/a41b4abafc826cb83c9f214a1371f4e68d2ee9f0) | `direct-preproduction` | `install --target codex`；Codex產出GPT Image 2 storyboard再產Seedance prompt；明示不執行video API。 |
| CSD-52 [ai-image-master `19b0a32`](https://github.com/2799662352/ai-image-master/commit/19b0a32ebf29e02ac5d1eeaa2b205beff72a7c06) | `direct-runnable` | 實際下載／啟動Codex CLI backend；grid-to-Seedance→submit/poll/download/persist；僅mock state tests。 |
| CSD-53 [imagine-campaign-director `f4a7db4`](https://github.com/Vyro-ai/imagine-campaign-director/commit/f4a7db48167d1280a58ab06bd35392d1f769571f) | `direct-runnable` | Codex app Computer Use角色→image-grounded Seedance→ffprobe／manifest→HyperFrames；無公開run receipt。 |
| CSD-54 [superVideoGenarateFactory `9a55438`](https://github.com/alyunzhangu/superVideoGenarateFactory/commit/9a55438f59a624daa08e2ca98351700db006ba9c) | `direct-runnable` | `.codex`／Codex skill→拆鏡／九宮格→Ark submit/poll/download；只有dry-run與unit tests。 |
| CSD-55 [capsule-cinema `5315a59`](https://github.com/JuneYaooo/capsule-cinema/commit/5315a59d47eab80f129fb3f98551e12553ef61be) | `direct-runnable` | `install_as_skill --target codex`→分鏡批准→Seedance／豆包TTS→FFmpeg release／QA；內嵌影片缺逐片Codex/provider provenance。 |
| CSD-56 [MythoFrame-AI `f725196`](https://github.com/LingFengJ/MythoFrame-AI/commit/f72519685195880c7ad26a6fb3e44e76604c69ce) | `direct-runnable` | `codex_handoff`／`codex_web`→shot/storyboard→Dreamina Seedance→import/select→rough cut；只有測試。 |
| CSD-57 [lianhuanhua-skills `244675a`](https://github.com/littlewindy123/lianhuanhua-skills/commit/244675ac1645765e08ac7395d0e0c32fcaf7af8b) | `direct-runnable` | OpenAI Codex CLI/app→分鏡／生圖＋豆包TTS＋FFmpeg final＋ffprobe gate；無真豆包receipt，且不是生成式動態影片。 |
| CSD-58 [plotloom `eb7bc85`](https://github.com/T0UGH/plotloom/commit/eb7bc856058d1a97a1a6a5640accdc238e4efc64) | `direct-runnable` | `codex-app-server`／Codex binary→images→Dreamina／Seedance→selection／stitch／subtitle；fake HTTP測試。 |
| CSD-59 [open-design `6b90486`](https://github.com/nexu-io/open-design/commit/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf) | `direct-preproduction` | daemon內建Codex CLI／`.codex`；Seedance目前只到prompt/template資產，HyperFrames是另一渲染層。 |
| CSD-60 [video-editing-skill `79bbc4d`](https://github.com/maxazure/video-editing-skill/commit/79bbc4d2cf9e527363f1c18336fa767c29ebe368) | `direct-preproduction` | Codex CLI／imagegen→Dreamina video prompt pack與generation handoff；只記錄／輪詢／下載，不提交provider job。 |

五個附成片的社群來源（FeicaiClub、煙花老師、探路AI、RalfNick、Victor Freitas）因只裸稱Codex、沒有可定位的OpenAI Codex專屬入口，全部維持`adjacent`，不加direct。

## 目前可誠實報告的數字

- 通過嚴格來源與去重稽核的direct：**30**。
- 其中`direct-executed`：**4**。
- `direct-runnable`：**19**。
- `direct-preproduction`：**7**。
- 「30個direct」研究目標已補齊；距離「30個executed」仍缺 **26**。
- stable IDs：CSD-01、03、05、12、13、14、41、42、48、49、50、51～69。每案只計一次；CSD-61～69見`completion-cases-61-69.md`。

這個數量不是agent資格或知識包accepted count；30案仍在knowledge pack quarantine，生成與發布閘門仍關閉。
