# CSD-01～30 可重現性審計

檢索日：2026-07-20  
狀態：`candidate_evidence_reviewed_not_accepted`  
判定準則：只有同一條 `input → task/request → raw output → selection → edit → final → QA/hash` 可追溯鏈，才可稱可重現執行。

| ID | 固定版本／日期 | 審計判定 |
|---|---|---|
| 01 | [e556a6b](https://github.com/Jane-xiaoer/paper-collage-ad-codex/commit/e556a6b708ef17a8bbf487df5ed2f7296f3e7bb1) | runnable implementation；無MP4／request／QA trace |
| 02 | [67858a9](https://github.com/video-production-buddy/video-production-buddy/commit/67858a942e1371c98258c01f97bea70f634cb386) | output demo；未連回Codex＋Seedance checkpoint |
| 03 | [115d9dd](https://github.com/T0UGH/videoclaw/commit/115d9dd47e27b2b1c863f2a6673566da50578801) | runnable package；測試為mock／fake video |
| 04 | [117dceb](https://github.com/Supreme-Ultimate/novel-to-script-team/commit/117dceb048cfb7f94e06c5b64a4faa435b6c31e0) | preproduction pipeline；止於prompt/frame handoff |
| 05 | [5ae678a](https://github.com/NewTurn2017/seedance-storyboard-skill/commit/5ae678a687c15ab714a3bc9ff7dad013718bc700) | runnable preproduction package；無影片runtime |
| 06 | [57d01dc](https://github.com/Emily2040/seedance-2.0/commit/57d01dc66f93ecb03c2475be5f22dc416d9b701d) | mature production OS；live eval仍pending |
| 07 | [97cd348](https://github.com/woodfantasy/Seedance2.0-ShotDesign-Skills/commit/97cd348ad8ca75801dc2a144ae9709fbcab8e9b2) | prompt validator；54 tests不等於審片 |
| 08 | [23c6567](https://github.com/luofeiawyjwj/seedance-prompt-writer/commit/23c6567473a738a635e4043fb49cdb70dd89a2f3) | prompt skill；明示不是API client |
| 09 | [2602397](https://github.com/Microck/seedance-skills/commit/260239717f1692e4b9e304609718ce81dcb7c840) | montage preproduction rubric；無generator／stitch runtime |
| 10 | [a599301](https://github.com/Alisa0808/vibe-creating-skill/commit/a599301980a66eb47ddac5c15e41081b74a2759d) | 有輸出附件；無Codex session／request／hash trace |
| 11 | [cfca9c9](https://github.com/scotti1i/seedance-2.0-superprompt/commit/cfca9c92493c26d8517d07ed5688d8581b09f6c1) | prompt OS；作者明示不是video generator |
| 12 | [c809392](https://github.com/JianhuiWei7/VideoWeaver/commit/c809392fe6c2c8b22472049684aaefc650e31bde) | research-executed；trace architecture最完整，未重現私享家 |
| 13 | 2026-07-04 | vendor demo；有畫面，無source／machine-readable trace |
| 14 | 2026-05-08 | creator-executed；公開6:21作品，log多為文章範例 |
| 15 | [d14d993](https://github.com/openakita/openakita/commit/d14d993aaf4242efd4c6ea3f71b3724c533e8ff2) | adjacent runtime；無公開accepted-take ledger |
| 16 | [90cd35d](https://github.com/SamurAIGPT/Generative-Media-Skills/commit/90cd35da52c80c9acc7463c29f51d9f5cd0107af) | adjacent runtime recipe；無同manifest成片provenance |
| 17 | [a2ab7fd](https://github.com/MapleShaw/seedance2.0-prompt-skill/commit/a2ab7fd9b73e1d531fabd7f59f390e8d39dc57a5) | preproduction method；無API／成片 |
| 18 | [b84a61a](https://github.com/netease-youdao/LobsterAI/commit/b84a61a5e79bcdd6be39923c4c6638338d0a88dd) | adjacent runtime；生成與Remotion未串成同manifest |
| 19 | [8ea9aa4](https://github.com/bigbigraydeng-maker/magic-engine/commit/8ea9aa4b1991763c91eb23c7e88b29c09edfaa9b) | hybrid project artifacts；先前自動batch推論撤回 |
| 20 | [930f891](https://github.com/heygen-com/hyperframes-launch-video/commit/930f89186b8e155d632d9afe49054c02d4d7d85a) | compositing runtime；Seedance insert來源未驗 |
| 21 | [eb0260b](https://github.com/ludobos/feliguard/commit/eb0260bfc0b4e347524127d20299c86cab11d330) | documented failure；適合作成本／退件回歸案例 |
| 22 | 2026-04-02活動 | vendor demonstration／claims；不可重現 |
| 23 | [bc61ec7](https://github.com/HBAI-Ltd/Toonflow-app/commit/bc61ec7a1b5df31293b286981a5f4ad4635464ee) | adjacent runtime＋author demo；成本時間自述 |
| 24 | YouTube 2026-04-29 | tutorial＋downloadable workflow；Drive JSON未固定hash／稽核 |
| 25 | YouTube 2026-06-09 | demonstrated experiment；無code／API log |
| 26 | 2026-04-16 | creator tutorial；無project／raw takes／task IDs |
| 27 | 2026-03-20 | secondary article；無repo／log／工程 |
| 28 | X 2026-02-12 | adversarial demo；三隻手與路由疑慮，不作正向案例 |
| 29 | [f6698ab](https://github.com/AKCodez/higgsfield-claude-skills/commit/f6698ab7a87223b67a76ce748ca1b936a8b5d399) | browser recipe；不符合本案非網頁生成路線 |
| 30 | [b695284](https://github.com/xuanyustudio/LocalMiniDrama/commit/b695284b8288e392a4ce2a63717406f3830966af) | strong adjacent runtime；demo的Seedance model provenance未驗 |

## 統計邊界

- CSD-15／16／18／23／30 同屬 runtime 群，不可當五次獨立畫面品質驗證。
- CSD-25／26／27 同屬公開工作流展示群，不可重複加權。
- CSD-21／28／29 是失敗或風險證據，價值在建立退件規則，不計成功率。
- 目前 30 案仍是候選知識庫，不是 30 次本機重現；accepted evidence 仍需不同 reviewer 的雙重 PASS。
