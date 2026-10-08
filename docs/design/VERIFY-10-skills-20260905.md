# Design Skills 驗證報告 — 2026-09-05

路徑根目錄：`/workspace/design-skills-20260905/`
用途：萃取可用核心給 **私享家**（台灣洗衣／洗鞋實體店：落地頁、POS UI、發布頁）— **排除**通用 SaaS 行銷套版語氣。

---

## 1. Clone 結果

| Repo | URL | 結果 | 本機路徑 |
|------|-----|------|----------|
| Hallmark | https://github.com/Nutlope/hallmark.git | **OK** (depth 1) | `/workspace/design-skills-20260905/hallmark/` |
| PencilPlaybook | https://github.com/stevembarclay/pencilplaybook.git | **OK** (depth 1) | `/workspace/design-skills-20260905/pencilplaybook/` |
| UI UX Pro Max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git | **OK** (depth 1) | `/workspace/design-skills-20260905/ui-ux-pro-max-skill/` |

三個皆 clone 成功；無需標記失敗。

---

## 2. License

| Repo | License |
|------|---------|
| Hallmark | **MIT** (hallmark/LICENSE, Copyright 2026 Hallmark contributors) |
| PencilPlaybook | **MIT** (pencilplaybook/LICENSE, Copyright 2026 Steve Barclay) |
| UI UX Pro Max | **MIT** (ui-ux-pro-max-skill/LICENSE, Copyright 2024 Next Level Builder) |

---

## 3. 安裝方式（Cursor / Claude / Codex）

> 本任務**未**安裝到 ~/.claude、**未**改 Windows、**未**付費。以下僅記錄官方建議。

### Hallmark (preferred for landing / publish pages)
- One-shot: npx skills add nutlope/hallmark
- Or copy SKILL.md + references/ manually:
  - Claude Code: ~/.claude/skills/hallmark/
  - Cursor: .cursor/rules/hallmark.mdc (SKILL body, strip frontmatter)
  - Codex: ~/.codex/skills/hallmark/ (personal) or .codex/skills/hallmark/ (project)
- Extracted copy: /workspace/design-skills-20260905/extracted/hallmark/

### PencilPlaybook (Pencil.dev canvas workflow)
- Clone into Claude skills dir (global or per-project .claude/skills/PencilPlaybook)
- Run setup wizard in Claude Code; README requires Pencil.dev installed and open
- Extracted: /workspace/design-skills-20260905/extracted/pencilplaybook/

### UI UX Pro Max (searchable rules + Python search)
- CLI package ui-ux-pro-max-cli; init with --ai cursor / claude / codex
- Also: npx ui-ux-pro-max-cli init --ai cursor
- Needs local Python 3.x (no extra pip deps) for scripts/search.py
- Extracted: /workspace/design-skills-20260905/extracted/ui-ux-pro-max/

---

## 4. Runnable without paid SaaS?

| Repo | Without paid SaaS? | Notes |
|------|--------------------|-------|
| Hallmark | YES | Pure text skill rules; Together AI account not required to use as rules |
| PencilPlaybook | LIMITED | MIT skill free, but workflow tied to Pencil.dev MCP/.pen |
| UI UX Pro Max | YES | Local CSV/JSON + Python search; optional PayPal donate only |

---

## 5. Token-heaviness warnings

- Hallmark: SKILL.md long; references/ ~450KB+ text. Loading all refs at once is VERY heavy. Prefer on-demand: anti-patterns, slop-test, structure, responsive. Component-scope skips macrostructure/hero.
- PencilPlaybook: full repo ~14MB. Use Canvas Archaeology + scoped prompts; keep .pen under ~15-20 screens.
- UI UX Pro Max: skill dir ~3.6MB CSV-heavy. Use search.py queries; do not dump entire data into context.

私享家策略：Hallmark anti-slop 為主；POS 用 component-scope + 8 states；配色字體用 UI UX Pro Max 窄域查詢；無 Pencil.dev 則暫略 PencilPlaybook。
---

## 6. Key files inside clones

### Hallmark
- Skill: hallmark/skills/hallmark/SKILL.md
- Anti-slop: references/anti-patterns.md, references/slop-test.md (58 gates + pre-emit 6 axes)
- Structure: structure.md, macrostructures.md, layout-and-space.md, responsive.md
- Copy/interaction: copy.md, interaction-and-states.md, microinteractions.md

### PencilPlaybook
- Skill: pencilplaybook/SKILL.md
- Setup: setup.md, onboarding.md
- References: pencilplaybook/references/tool-reference.md

### UI UX Pro Max
- Skill: ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/SKILL.md
- Rules: references/quick-reference.md, pro-rules.md
- Data/search: data/*.csv, scripts/search.py

---

## 7. Extracted paths (success check)

- VERIFY: /workspace/design-skills-20260905/VERIFY.md
- Hallmark SKILL: /workspace/design-skills-20260905/extracted/hallmark/SKILL.md
- Hallmark references: /workspace/design-skills-20260905/extracted/hallmark/references/
- PencilPlaybook: /workspace/design-skills-20260905/extracted/pencilplaybook/
- UI UX Pro Max: /workspace/design-skills-20260905/extracted/ui-ux-pro-max/
---

## 8. Core lessons（繁中 · 給 Obsidian · 對準私享家）

> 從 Hallmark anti-slop／結構紀律 + UI UX 可及性／觸控規則濃縮；刻意避開 Features／Pricing／Docs 式 SaaS 腔。

- **結構要像店，不要像新創模板**：禁止預設「全螢幕置中 Hero → 三欄圖示功能卡 → CTA → Footer」。落地頁用真實服務節奏（收件／工期／價目／據點／案例照）；發布頁用清晰資訊層級，不要 Specimen 編排預設落到洗衣店。
- **拒絕 AI 審美指紋**：紫藍粉漸層 Hero、漸層標題字、Inter／Roboto 單字體通吃、左側粗色條卡片、card-in-card、emoji 當功能圖示 — 一律當成 slop。
- **誠實文案**：沒有真實數據就不要發明轉換率或「信任團隊」數字。私享家用真實工期、據點、價目、顧客許可之評價；缺資料用「待確認」區塊，不要假 testimonials。
- **Token 鎖定**：主題選定後只用命名 token（色／字體），禁止中途硬塞任意 hex／臨時字體 — POS 與官網要共用同一套品牌 token。
- **組件 ≠ 整頁**：POS 按鈕、輸入、狀態列走 component-scope；每個互動元件要有完整狀態（default／hover／focus／active／disabled／loading／error／success），不要只做 hover。
- **觸控與可及性（門市／平板 POS）**：點擊區至少約 44×44px；對比至少 4.5:1；可見 focus；支援鍵盤；尊重 prefers-reduced-motion；禁用態約 40% 透明度（別用會搶戲的 50%）。
- **行動版硬底線**：320／375／414／768 無橫向捲動；按鈕與導覽文字避免兩行可點文字；長標題要能斷行；圖片格用 minmax(0,1fr)。
- **標題純度**：標題不要斜體／不要用 em 當 AI 強調；用字重、品牌強調色或底線表達重點。
- **導覽要像在地服務業**：避免 Features · Pricing · Docs · Blog · About 那種 AI SaaS nav；改為服務、價目、據點、預約／LINE、案例等真實資訊架構。
- **克制動效**：禁止 transition:all、到處 scale-105、彈跳 easing 用在一般 UI；成功回饋能靜默就靜默（POS 已看到結果就不必慶祝 toast）。
- **多樣性紀律**：同一專案連續兩頁不要共用同一個 macrostructure 指紋；官網首頁、活動發布頁、會員頁應有不同版面節奏，而不是換色模板。
- **工具選用**：落地頁／發布頁 → Hallmark 規則為主；查配色字體／UX checklist → UI UX Pro Max 窄域 search；PencilPlaybook 僅在有 Pencil.dev 時再啟用。

---

## 9. 與私享家無關、可忽略的部分

- Hallmark 展示站大量 SaaS／portfolio demo（Tally、Hyperlane 等）— 學規則，別抄版型腔調。
- PencilPlaybook 的 .pen／MCP 工作流 — 目前非必要。
- UI UX Pro Max 的 GSAP／多 stack CSV — 按需查詢，勿整包載入。
