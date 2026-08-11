# Codex＋豆包／Doubao／Seedance 影片製作案例：30案候選登錄

查核截止：2026-07-20（含 CSD-61～69 補齊稽核）  
狀態：`independently_reviewed_candidate_quarantine`  
計數：本檔保留前 30 案主表；補充與補齊見 `supplemental-cases-31-40.md`、`supplemental-cases-41-50.md`、`completion-cases-61-69.md`。2026-07-20 獨立複審後，不再用「repo有程式／文章有影片」推論為 `executed`。  

> **Direct 計數（嚴格來源與去重稽核後）**：依「同一來源明示OpenAI Codex專屬入口、Codex產物確實進入豆包／Seedance鏈、API wrapper與泛相容不算」的規則，目前確認 **30案 direct**：4案 `direct-executed`、19案 `direct-runnable`、7案 `direct-preproduction`。accepted／本機重現仍為0。詳見 `direct-case-adversarial-audit-2026-07-20.md` 與 `completion-cases-61-69.md`。

精確案例再分級：

- 有實驗／創作者執行證據：CSD-12、CSD-14；不代表已重現私享家案例。
- 有可播放輸出但缺完整 Codex→Seedance trace：CSD-02、CSD-10、CSD-13、CSD-23。
- 其餘分為 runnable runtime、前製方法、合成工程、展示／文章與反例；不得合併計成成功案例。

| ID | 案例與直接來源 | 分類 | 已證明的方法 | 私享家可蒸餾經驗 | 主要限制 |
|---|---|---|---|---|---|
| CSD-01 | [paper-collage-ad-codex](https://github.com/Jane-xiaoer/paper-collage-ad-codex) | exact-runnable | Codex從brief、劇本、分鏡、首圖核准到Seedance Ark、TTS、音樂、FFmpeg與ffprobe QA | 每鏡manifest；昂貴生成前先做人審；聲音與公開skill分離 | repo無MP4、request ID或QA run，不能稱已執行 |
| CSD-02 | [video-production-buddy](https://github.com/video-production-buddy/video-production-buddy) | output-demo-untraced | `research→proposal→script→scene_plan→assets→edit→compose→publish`狀態機、預算與人工gate | 不允許silent fallback；提案時鎖renderer；reviewer獨立 | 成片未連回Codex session、Seedance request與checkpoint |
| CSD-03 | [videoclaw](https://github.com/T0UGH/videoclaw) | exact-runnable-mocked | Codex圖片、Seedance I2V、多候選、音訊與FFmpeg合成 | production unit分離；candidate與selected分開；clip級重跑 | Seedance測試是MagicMock/fake data；無公開真實run |
| CSD-04 | [novel-to-script-team](https://github.com/Supreme-Ultimate/novel-to-script-team) | exact | Codex多Agent：小說→劇本→商業/合規雙審→導演/美術/分鏡→Seedance prompt review | 每階段生成、審核、回改、復審；跨集continuity state | 不直接生成影片；屬前製handoff |
| CSD-05 | [seedance-storyboard-skill](https://github.com/NewTurn2017/seedance-storyboard-skill) | exact | Codex Desktop：idea→key visual批准→story→storyboard loop→SHOT prompt package | raw idea不可直接跳prompt；故事與關鍵視覺雙gate | 無影片API、成片或授權 |
| CSD-06 | [Seedance 2.0 Skill OS](https://github.com/Emily2040/seedance-2.0) | exact | Codex installer、project state、reference roles、continuity、retake、delivery QC、evals | accepted footage才是下一段真相；一次只改一個retake變因 | 是製片技能，不是已執行成片證據 |
| CSD-07 | [Seedance2.0 ShotDesign Skills](https://github.com/woodfantasy/Seedance2.0-ShotDesign-Skills) | exact | Codex安裝、六要素prompt、硬校驗、首尾幀、聲音、延長與多場景 | 一鏡一動；I2V只描述變化；先驗資產與衝突 | 只驗prompt，不驗影片品質 |
| CSD-08 | [seedance-prompt-writer](https://github.com/luofeiawyjwj/seedance-prompt-writer) | exact | Codex skill分層、reference角色、examples、eval與prompt scorer | prompt也要版本化與回歸測試 | 明確不是API client；scorer不等於成片QA |
| CSD-09 | [seedance-skills](https://github.com/Microck/seedance-skills) | exact | Codex安裝；VO→5段；每段2–4 takes→選最佳→stitch | 多take選擇比期待一次成功可靠；短殘片可降級成轉場 | 只有skill與rubric，沒有生成/合成程式 |
| CSD-10 | [vibe-creating-skill](https://github.com/Alisa0808/vibe-creating-skill) | exact | Codex skill先判斷方法是否適合，再保留視覺錨、行為、調性與主題 | 不把所有故事硬塞同一prompt模板 | 維護者有商業利益；只產prompt |
| CSD-11 | [seedance-2.0-superprompt](https://github.com/scotti1i/seedance-2.0-superprompt) | exact | Codex可手動載入；write/lint/fix、25規則、多模式decision tree | prompt編譯、lint、repair分開；修正要顯示diff | Claude為主入口；hero take仍需2–5次 |
| CSD-12 | [VideoWeaver](https://github.com/JianhuiWei7/VideoWeaver)／[paper](https://arxiv.org/abs/2606.08091) | exact | Codex/agents組合圖像、Seedance 2.0、音訊、合成、ASR與eval；保存trace與中間素材 | generation trace＋intermediate＋final雙層QA；先dry-run | benchmark，不是私享家商業案例；需付費API |
| CSD-13 | [AnyCap Codex＋Seedance 2](https://anycap.ai/page/en-US/ai/how-to-use-seedance-2-codex) | exact | Codex CLI從storyboard呼叫Seedance 2並展示操作與完成影片 | 先storyboard；Fast草稿、標準版候選final | 供應商示範；無source、API trace、聲音與後製細節 |
| CSD-14 | [CreativeEdge Codex＋Seedance 2.0製片法](https://note.com/creative_edge/n/n4fc40dd69e88?hl=en-US) | exact | Codex拆語意/物理事件、三版prompt、generation log、failure taxonomy、v2與AGENTS規則 | 心理/因果由劇本鎖；物理連續交模型；Codex最適合讀失敗檔案建立規則 | 創作者案例，不是模型官方規格；需以自家測試驗證 |
| CSD-15 | [OpenAkita](https://github.com/openakita/openakita) | adjacent-agent | 真Agent plugin：Seedance T2V/I2V、首尾幀、extend、長片拆分、last-frame chaining、FFmpeg與tests | 長片必須有鏈式狀態、失敗中止與chain group去重 | 非Codex；AGPL；mock測試不等於視覺品質 |
| CSD-16 | [Generative Media Skills](https://github.com/SamurAIGPT/Generative-Media-Skills) | adjacent-agent | 41 recipes；storyboard、產品hero、Seedance、native audio與人工approval | 產品圖先核准再動；每段single beat；draft/full-res分流 | 無Codex；依賴MuAPI；機器QA不足 |
| CSD-17 | [MapleShaw Seedance skill](https://github.com/MapleShaw/seedance2.0-prompt-skill) | adjacent-agent | 劇本→角色卡→分鏡→關鍵幀→逐鏡生成→延長→後製 | 同一角色圖重複引用；失敗只重生該鏡 | 無Codex與影片API；方法論為主 |
| CSD-18 | [LobsterAI](https://github.com/netease-youdao/LobsterAI) | adjacent-agent | OpenClaw agent、Seedance async生成、首尾/多reference、Remotion剪輯技能 | duration驗證、poll timeout、local image處理與後製技能分離 | Seedance與Remotion未強制串成單一manifest；文件有舊資訊 |
| CSD-19 | [magic-engine](https://github.com/bigbigraydeng-maker/magic-engine) | adjacent-hybrid-artifacts | 客戶實拍／圖卡→可選單鏡I2V→PM以CapCut／Premiere合成 | 實拍主證據、生成只作備案；素材與交接明列 | 未找到原先推論的自動batch runtime；MP4不證明生成來源 |
| CSD-20 | [HyperFrames launch video](https://github.com/heygen-com/hyperframes-launch-video) | adjacent-tooling | 49.77秒可render專案；Seedance只作A-roll insert，文字/UI/聲音確定性合成 | Seedance負責人物素材；Logo、lower third、字幕、波形留後製 | 無Codex；Seedance insert缺generation log；素材授權未明 |
| CSD-21 | [FELIGUARD pipeline](https://github.com/ludobos/feliguard)／[成本失敗復盤](https://www.streaming-radar.com/p/i-spent-120-trying-to-make-an-ai) | adjacent-demonstrated | 小說→14鏡storyboard→keyframes→Seedance/Veo→FFmpeg；公開預算與失敗 | 一致性、異常修復、文字污染、音訊與成本都要記錄 | Claude Code；非Codex；跨模型流程 |
| CSD-22 | [火山劇創《凡世塵緣》](https://developer.volcengine.com/articles/7622325633040793641) | vendor-demonstration | 多Agent解析劇本、角色/場景/道具、分鏡、Seedance 2.0、匯出剪映 | 只借用stage-gate概念 | 無source、raw takes、logs或可下載project；效率數字不採信 |
| CSD-23 | [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app/blob/master/docs/README.en.md) | adjacent-runtime-author-demo | ScriptAgent＋ProductionAgent→劇本、分鏡、素材、Seedance 2.0、拼接 | 必須記錄不可用素材比例；成片長度由可用take決定 | 時間／成本為作者自述；缺task IDs與take ledger |
| CSD-24 | [n8n Seedance 2 workflow](https://www.youtube.com/watch?v=PRalN9AnZyA) | adjacent-demonstrated | script/scenes/assets/audio→Seedance API→caption→final產品片 | 將內容、素材、聲音與發布拆成節點；可下載workflow | affiliate導流；無正式QA與口型測試 |
| CSD-25 | [Edit Illusions storyboard test](https://www.youtube.com/watch?v=7qBYe_VX_lE)／[transcript](https://moderncreator.app/2026-06-09-edit-illusions-i-gave-seedance-2-0-my-entire-storyboard) | adjacent-demonstrated | Claude＋GPT Image/Nano Banana做格狀storyboard，Seedance一次生成14秒，五案比較 | 整張storyboard適合pitch；交付片仍應逐鏡生成 | panel轉場、人物漂移、末格失準 |
| CSD-26 | [The Writer workflow](https://www.aisuperhub.io/blog/how-to-use-seedance-20-for-ai-filmmaking-full-workflow) | creator-tutorial | 角色表、Seedance動作、Topaz、Premiere、分層聲音；5秒只取約2秒 | 先角色reference；記錄usable-seconds ratio；聲音分層 | 無原始工程、prompt pack、task IDs與成本；不稱可重現 |
| CSD-27 | [《覺醒》多AI短片](https://k.sina.com.cn/article_7879848900_1d5acf3c401902swru.html?from=photo) | secondary-workflow-article | 劇本→分鏡→prompt→角色首幀→Seedance→後製 | 只借用標準化handoff與角色分工 | 無repo、task log、raw clip或工程；數據無可追來源 |
| CSD-28 | [ChatCut＋OpenClaw UGC](https://x.com/chatcutapp/status/2021967628387139989)／[獨立復盤](https://piunikaweb.com/2026/02/13/seedance-2-0-chatcut-viral-amazon-ugc-video-scrutiny/) | adjacent-demonstrated | Agent讀商品頁與照片→Seedance UGC＋口播；有可見成片 | 真產品資料可驅動腳本與reference；成片仍需手部QA | X僅線索；路由存疑；成片出現三隻手 |
| CSD-29 | [AKCodez Higgsfield skills](https://github.com/AKCodez/higgsfield-claude-skills) | browser-recipe-negative | Playwright流程：角色圖→Higgsfield網頁→人工確認→生成 | 只借用送出前批准概念 | 無成片/task log；UI脆弱，且本案明確不採瀏覽器生成 |
| CSD-30 | [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama) | adjacent-code | 故事→角色/場景/道具→分鏡→圖/片→合成；Seedance多圖與尾幀銜接 | 素材資產化、逐鏡重跑、尾幀continuity | 公開一致性demo是即夢1.0，不得冒充Seedance 2.0成片 |

## 明確排除

- 純 create/check API 或MCP包裝：不具劇本、導演、剪輯、聲音或QA經驗。
- prompt gallery／awesome list：可作搜尋入口，不算製片案例。
- fork、鏡像、無程式碼landing page與無法驗證的匿名企業成效。
- README聲稱Seedance 2.0，但實際程式只有Kling或Seedance 1.x的專案。
- 用Codex完成網站前端，但影片runtime與Codex無關的案例，不標exact。
