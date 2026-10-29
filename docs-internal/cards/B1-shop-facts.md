# 任務卡 B1:店務事實檔(一個事實只住一個家)

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄:C:\Users\cyc39\Documents\New project 5 只能新增/改 `docs-internal/SHOP-FACTS.md` 與 `docs-internal/cards/B1-RESULT.md`

## 目的
LINE bot(店機 FXwash kit)、每日圖文(auto-poster)、網站(docs/)三邊對客人講的事實要一致。現在事實散在程式與 prompt 裡。先盤出來、對齊、標衝突;**不改任何程式**,改程式是下一張卡。

## 店主已定的對客事實(硬規則,以此為準)
- 交期:一般衣物 5–7 天、鞋 7 天、難乾的大件 10–14 天、皮件包 14 天。
- 價格:不寫,除非店主當次給。
- 不標示「AI 生成」;不冒充真實客件;不編造案例、數字、成效。
- 不確定的一律標「待店主確認」。

## 來源(只讀,讀不到就註明)
1. `shop-pc/fxwash/shop.json`(營業時間、收送時段、地址電話、模組)
2. `shop-pc/fxwash/config/Dialog_Phrases.json`、`config/dialog_corpus.py`、`config/Memory.md`、`config/Clothing_Memory.md`、`runtime/chat_service.py`(bot 實際會說的話)
3. `shop-pc/fxwash/config/prices.json`(只記「有哪些品項與分類」,**不抄價格**)
4. `line-bot/conversation.py`、`line-bot/quote_flow.py`(ai 電腦舊 bot 的規則,僅供對照)
5. `src/` 與 `config/` 裡每日圖文的 prompt / 店家資料(例:business-profile、persona)
6. `docs/services/*.html`、`docs/local/*.html` 的服務說明(抓交期、收送、營業時間相關句子)
7. Vault:`C:\Users\cyc39\Documents\AI-Agent-Vault\08-Knowledge\Approved\私享家-開店到關店SOP-v1.1\私享家-開店到關店SOP-v1.1.md`、`03-Projects\Smart-Laundry-AI\02_已決定規格.md`、`收件檢查表-v1.csv`(只讀)

## 產出 `docs-internal/SHOP-FACTS.md` 的格式
```
# 私享家 店務事實檔 v1(2026-10-29)
每條:事實 | 目前值 | 狀態(店主已定 / 來源一致 / 來源衝突 / 待店主確認) | 來源(檔名:行號,可多個) | 哪些系統在用(bot / 圖文 / 網站)
分節:營業時間與公休 / 收送(範圍、時段、免費條件) / 交期 / 服務項目與不接的東西 / 材質與風險提醒 / 付款方式 / 查件與綁定規則 / 人工接手條件 / 隱私與照片保留 / 品牌語氣與禁語
最後一節「衝突清單」:同一事實在不同來源說法不同的,逐條列出兩邊原文與行號。
```

## 禁止
不改程式、不抄價格數字、不抄客人資料、不連店機、不呼叫 API、不編造事實(找不到就寫「未找到」)。

## 驗收
- 每條事實都有可點的來源(檔名:行號);抽 10 條逐一對得上。
- 衝突清單不為空就要列原文;為空要寫「已逐一比對 X 個來源」。

## 交付
`docs-internal/SHOP-FACTS.md` + `docs-internal/cards/B1-RESULT.md`(讀了哪些檔、沒讀到哪些、衝突數、待店主確認數)。
