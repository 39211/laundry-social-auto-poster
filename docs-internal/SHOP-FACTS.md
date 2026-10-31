# 私享家 店務事實檔 v1(2026-10-29)

依 [B1-shop-facts.md:1](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:1>) 盤點。本卡只建立可追溯的店務事實與差異清單，不改程式、設定、既有網站或發布內容。

狀態解讀：**店主已定**僅指 B1 卡明列的硬規則；**來源一致**指本次查閱範圍內此欄未見相反說法，不代表店主當次確認、獨立驗證或店機已啟用；**來源衝突**保留各版本；**待店主確認**包含未找到、僅單方宣稱、設定未驗收及適用範圍未定。交期的「天」保留原單位，不自行換算工作天。

「哪些系統在用」記錄本機來源位置與對齊對象，含「應採用／待核對／規格參考」的項目不表示已部署。「圖文店家資料」指 repo 內共用 business-profile，未證明每篇 caption 都讀取該欄。舊 bot 僅供對照，Smart-Laundry-AI 文件僅在原研究／影子規格範圍內作參考；沒有連店機或呼叫 API。

盤點共 **77 條**：店主已定 9、來源一致 43、來源衝突 5、待店主確認 20。末節另按主題整理 **11 組衝突／口徑差異**，含已由硬規則定案但下游未對齊的項目，因此組數不等於「來源衝突」列數。來源清冊、未讀範圍與驗證見 [B1-RESULT.md:1](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-RESULT.md:1>)。

## 營業時間與公休

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F01 平日對客營業時間 | 週一至週五 10:00–20:00；開店準備時間不當作對客營業時間。 | 來源一致 | [shop.json:16](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:16>)；[business-profile.json:31](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:31>)；[Vault/私享家-開店到關店SOP-v1.1.md:26](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:26>) | bot／圖文店家資料／網站 |
| F02 週六對客營業時間 | 12:00–18:00。 | 來源一致 | [shop.json:46](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:46>)；[business-profile.json:31](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:31>)；[chat_service.py:111](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:111>) | bot／圖文店家資料／網站 |
| F03 固定公休日 | 週日公休；不等於 LINE、人工客服或查件已通過全年無休驗收。 | 來源一致 | [shop.json:50](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:50>)；[business-profile.json:31](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:31>)；[Vault/私享家-開店到關店SOP-v1.1.md:26](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:26>) | bot／圖文店家資料／網站 |
| F04 重大節日／連假 | 以店家當期公告為準；資料檔 overrides 為空，未找到本次已確認的特殊日期時段。 | 待店主確認 | [business-profile.json:57](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:57>)；[business-profile.json:59](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:59>)；[business-profile.json:67](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:67>) | 圖文店家資料／網站；bot 需當次核對 |
| F05 實體門市地址與地標 | 台中市西屯區青海路二段365號，至善國中對面。結構化完整地址另含郵遞區號與至善里，屬同一門市的表示差異。 | 來源一致 | [shop.json:7](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:7>)；[business-profile.json:16](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:16>)；[business-profile.json:17](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:17>)；[Vault/私享家-開店到關店SOP-v1.1.md:25](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:25>) | bot／圖文店家資料／網站 |
| F06 市話與手機分工 | 市話 04-2452-7411；手機／LINE 聯絡號碼 0968-327-653。兩者不是同一欄位的衝突值。 | 來源一致 | [business-profile.json:27](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:27>)；[business-profile.json:30](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:30>)；[conversation.py:70](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:70>)；[shop.json:8](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:8>) | bot／圖文店家資料／網站 |
| F07 LINE 入口 | 資料檔 LINE ID 為 0968327653，LINE 連結另存 line_url；本次未登入、未傳訊驗證入口。 | 來源一致 | [business-profile.json:25](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:25>)；[business-profile.json:26](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:26>)；[contentPlan.ts:1839](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1839>) | bot／圖文／網站 |
| F08 地圖連結 | kit 的 map_url 指向痞客邦介紹頁，business-profile 指向 Google Maps。正式對客地圖入口待店主確認，不自動改值。 | 待店主確認 | [shop.json:9](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:9>)；[business-profile.json:18](<C:/Users/cyc39/Documents/New project 5/data/business-profile.json:18>) | bot／圖文店家資料／網站 |
| F09 門市數量與東海據點 | 網站說明唯一實體門市在西屯；東海無門市、僅收送。其他地區頁不是分店證明。 | 來源一致 | [business-bulk-laundry.html:635](<C:/Users/cyc39/Documents/New project 5/docs/services/business-bulk-laundry.html:635>)；[donghai-laundry-pickup.html:410](<C:/Users/cyc39/Documents/New project 5/docs/local/donghai-laundry-pickup.html:410>) | 網站；bot／圖文未見分店設定 |

## 收送(範圍、時段、免費條件)

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F10 收送服務範圍 | 網站與部分圖文寫台中全市／全區；kit 語料與部分圖文寫市區，shop.json 只說洽門市。實際範圍與統一用詞待店主確認，見 C07。 | 來源衝突 | [taichung-citywide-laundry-pickup.html:665](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:665>)；[contentPlan.ts:826](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:826>)；[Dialog_Phrases.json:327](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:327>)；[shop.json:53](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:53>) | bot／圖文／網站 |
| F11 免費所指的費用 | 網站與圖文明寫收送免費；清潔／洗護另計。此處不抄清潔費金額，也不據此承諾其他免費服務。 | 來源一致 | [taichung-citywide-laundry-pickup.html:677](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:677>)；[contentPlan.ts:849](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:849>) | 圖文／網站；bot 費用門檻見下一條 |
| F12 最低消費／最低件數 | 網站與圖文說沒有低消、一件也收；bot 語料說滿額收送。適用條件待店主確認，見 C06。 | 來源衝突 | [Dialog_Phrases.json:324](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:324>)；[dialog_corpus.py:315](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:315>)；[contentPlan.ts:849](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:849>)；[taichung-citywide-laundry-pickup.html:677](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:677>) | bot／圖文／網站 |
| F13 收送時段 | kit 設定平日 10:00–12:00、14:00–17:00，週六 12:00–15:00；舊 bot 說跟營業時間一樣，網站另有 10:00–20:00 與依當下安排兩種說法。待店主確認，見 C08。 | 來源衝突 | [shop.json:55](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:55>)；[shop.json:59](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:59>)；[conversation.py:2261](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2261>)；[taichung-citywide-laundry-pickup.html:673](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:673>) | bot／網站；圖文會邀約但未列固定時段 |
| F14 預約時提供的資料 | 收送需先安排：提供品項／照片、大致地址、聯絡電話與方便時段；本檔只記欄位，不收錄任何客戶實值。 | 來源一致 | [Dialog_Phrases.json:330](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:330>)；[conversation.py:935](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:935>)；[taichung-citywide-laundry-pickup.html:673](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:673>) | bot／圖文／網站 |
| F15 即日車趟／到達鐘點 | 未找到可對外保證的當日可收或固定到達鐘點；網站要求 LINE 詢問當下安排。待店主確認當次車趟。 | 待店主確認 | [zhongke-office-laundry.html:463](<C:/Users/cyc39/Documents/New project 5/docs/local/zhongke-office-laundry.html:463>)；[clinic-uniform-laundry.html:294](<C:/Users/cyc39/Documents/New project 5/docs/services/clinic-uniform-laundry.html:294>) | bot／圖文／網站 |
| F16 變更、取消與管理室代收 | 語料有提前傳訊變更／取消，以及大樓管理室可配合的說法；個別地點的允許條件、最後變更時間未找到，待店主確認。 | 待店主確認 | [Dialog_Phrases.json:326](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:326>)；[Dialog_Phrases.json:341](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:341>) | bot；圖文／網站未找到完整同一規則 |
| F17 地標／機構不是代收點 | 網站明寫港區地標、園區不提供代收，沒有醫院合作／代收點；不能把地區介紹當作已合作的收件位置。 | 來源一致 | [wuqi-laundry-pickup.html:392](<C:/Users/cyc39/Documents/New project 5/docs/local/wuqi-laundry-pickup.html:392>)；[wuqi-laundry-pickup.html:538](<C:/Users/cyc39/Documents/New project 5/docs/local/wuqi-laundry-pickup.html:538>)；[shengang-laundry-pickup.html:491](<C:/Users/cyc39/Documents/New project 5/docs/local/shengang-laundry-pickup.html:491>) | 網站；bot／圖文不得據地標推定合作 |

## 交期

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F18 一般衣物標準交期 | 5–7 天。以本卡店主硬規則為準；不自行改成工作天。下游 3–4 個工作天、三到五天等說法見 C01。 | 店主已定 | [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[Dialog_Phrases.json:61](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:61>)；[conversation.py:851](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:851>) | bot／圖文／網站皆應採用；本卡未改下游 |
| F19 鞋類標準交期 | 7 天。白鞋網站已如此寫；bot 的 5–7 個工作天、4–5 個工作天及泛用 3–4 個工作天仍衝突，見 C02。 | 店主已定 | [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[white-shoe-cleaning.html:576](<C:/Users/cyc39/Documents/New project 5/docs/services/white-shoe-cleaning.html:576>)；[Dialog_Phrases.json:62](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:62>)；[chat_service.py:195](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:195>) | bot／圖文／網站皆應採用；網站部分頁一致 |
| F20 難乾的大件交期 | 10–14 天。僅適用本卡所說難乾的大件，不擴張成全部床組一律相同；厚棉被短交期說法見 C03。 | 店主已定 | [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[Dialog_Phrases.json:64](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:64>) | bot／圖文／網站皆應採用；未改下游 |
| F21 皮件包標準交期 | 14 天。皮件與包類網站已如此寫；bot 包包／精品皮件與小皮件天數不同，見 C04。 | 店主已定 | [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[luxury-bag-cleaning.html:493](<C:/Users/cyc39/Documents/New project 5/docs/services/luxury-bag-cleaning.html:493>)；[Dialog_Phrases.json:67](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:67>)；[Dialog_Phrases.json:79](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:79>) | bot／圖文／網站皆應採用；網站部分頁一致 |
| F22 未明列品項的細分交期 | 窗簾、帽子、薄被、修改等是否另有交期，以及皮衣是否包含在「皮件包」用語內，未找到本次店主定義；待店主確認，不把語料細分天數升格成已定規則。 | 待店主確認 | [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)；[B1-shop-facts.md:13](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:13>)；[Dialog_Phrases.json:75](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:75>)；[Dialog_Phrases.json:83](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:83>) | bot／圖文／網站 |
| F23 急件與特殊截止日 | 可先告知急用日期，交師傅／櫃台確認排程；未找到可無條件保證的急件完成時間，待店主確認當次可行性。 | 待店主確認 | [Dialog_Phrases.json:65](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:65>)；[conversation.py:852](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:852>)；[chat_service.py:97](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:97>) | bot／網站；圖文不得自行承諾 |

## 服務項目與不接的東西

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F24 價目檔分類／品項：包包 | 短皮夾、長皮夾、書包OR背包、大書包、全布包、布混包、皮包包、名牌包、特殊名牌包。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:6](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:6>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F25 價目檔分類／品項：皮件 | 皮帽子、皮衣、特殊皮衣、皮褲、皮短褲、皮裙、皮背心、皮帶、皮手套。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:53](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:53>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F26 價目檔分類／品項：衣服 | 女衣、襯衫、棉T、長T、帽T、短褲、長褲、西褲、牛仔褲、醫師服、羽絨背心、羽絨外套、西裝、西裝背心、短洋裝、中洋裝、長洋裝、禮服、毛衣、毛衣外套、圍巾、領帶、G-T外套、G-T外套2件式、帽子、薄外套、厚外套、針織衣、短大衣、中大衣、長大衣、短裙子、中裙子、長裙子、修改、整燙。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:100](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:100>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F27 價目檔分類／品項：床組 | 床組=床單+被套+枕套2、枕套、涼被、棉被(小)、棉被(大)、毛毯(小)、毛毯(中)、毛毯(大)、保潔墊、床單.被套(薄)、床單.被套(厚)、蠶絲.羊毛被子、羽絨被、枕頭 娃娃。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:282](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:282>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F28 價目檔分類／品項：高級 | 精品女衣、精品棉T、精品襯衫、精品帽T、精品長T、精品短褲、精品長褲、精品外套、精品厚外套、精品毛衣、精品毛衣外套、精品短洋裝、精品中洋裝、精品長洋裝、精品圍巾、精品帽子、精品手套、精品牛仔褲、精品短大衣、精品中大衣、精品長大衣、精品短裙子、精品中裙子、精品長裙子、精品背心。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:354](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:354>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F29 價目檔分類／品項：鞋子 | 一般運動鞋、皮運動鞋、混和運動鞋、童鞋、特殊鞋、名牌鞋、高跟鞋、皮鞋、大童鞋、麂皮鞋、一般登山鞋、高筒登山鞋、低靴子、中靴子、高靴子、拖鞋、高級拖鞋、涼鞋。僅登錄名稱；列入價目檔不代表每件實物都能承接。 | 來源一致 | [prices.json:481](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:481>)；[prices.json:1464](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:1464>) | bot 價目資料；圖文／網站是否逐項提供需另核對 |
| F30 服務／模組設定與啟用證據 | 本機 kit 列品牌 OA、human_faq、staff_handoff、progress_lookup；mode 仍是 demo，owner_confirmed 與驗收旗標為 false。實際店機啟用狀態待店主確認。 | 待店主確認 | [shop.json:4](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:4>)；[shop.json:103](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:103>)；[shop.json:114](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:114>) | bot；未連店機 |
| F31 到店送洗是否預約 | 一般到店送洗不用預約，在營業時間帶來；到府收送需先安排。 | 來源一致 | [Dialog_Phrases.json:295](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:295>)；[conversation.py:935](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:935>)；[conversation.py:936](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:936>) | bot／網站；圖文可沿用來源範圍 |
| F32 精品／特殊材質是否直接接件 | 需看過實物／照片與洗標，再說明風險及能否承接；不以品牌名稱保證可洗。 | 來源一致 | [conversation.py:991](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:991>)；[Vault/私享家-開店到關店SOP-v1.1.md:115](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:115>)；[Vault/私享家-開店到關店SOP-v1.1.md:123](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:123>) | bot／網站；圖文不得預先保證 |
| F33 修改、補膠、補色與配件修補 | 價目檔列修改、整燙，語料另聲稱補膠、掉扣縫補等；網站把修繕與清潔分開。實際提供項目、免費條件及承接方式待店主確認。 | 待店主確認 | [prices.json:100](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/prices.json:100>)；[chat_service.py:116](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:116>)；[Memory.md:53](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Memory.md:53>)；[secondhand-luxury-shop-cleaning.html:296](<C:/Users/cyc39/Documents/New project 5/docs/services/secondhand-luxury-shop-cleaning.html:296>) | bot／圖文／網站 |
| F34 醫療布品與證明 | 多個網站頁面明寫不收醫院／醫療布品、不做醫療滅菌、不開消毒／滅菌證明；員工個人便服與醫療布品要分開。僅記網站既有邊界。 | 來源一致 | [dali-laundry-pickup.html:460](<C:/Users/cyc39/Documents/New project 5/docs/local/dali-laundry-pickup.html:460>)；[wuqi-laundry-pickup.html:475](<C:/Users/cyc39/Documents/New project 5/docs/local/wuqi-laundry-pickup.html:475>)；[postpartum-center-laundry.html:375](<C:/Users/cyc39/Documents/New project 5/docs/services/postpartum-center-laundry.html:375>) | 網站；bot 診所被單合作話術需個別看件 |
| F35 診所固定窗口拒收範圍 | 診所窗口頁明列需要滅菌證明的件、不記名整包毛巾床組等不屬該窗口；不據此推定全部非醫療大量床組都拒收。 | 待店主確認 | [clinic-uniform-laundry.html:280](<C:/Users/cyc39/Documents/New project 5/docs/services/clinic-uniform-laundry.html:280>)；[clinic-uniform-laundry.html:281](<C:/Users/cyc39/Documents/New project 5/docs/services/clinic-uniform-laundry.html:281>)；[clinic-uniform-laundry.html:297](<C:/Users/cyc39/Documents/New project 5/docs/services/clinic-uniform-laundry.html:297>) | 網站；bot／圖文未見相同細分規則 |
| F36 真偽鑑定與轉售品相／售價 | 網站不做真偽鑑定、不提供品相等級或建議轉售售價；此處「不估價」指商品真偽／轉售價值情境，不抹除清潔初估流程。 | 來源一致 | [secondhand-luxury-shop-cleaning.html:323](<C:/Users/cyc39/Documents/New project 5/docs/services/secondhand-luxury-shop-cleaning.html:323>)；[secondhand-luxury-shop-cleaning.html:449](<C:/Users/cyc39/Documents/New project 5/docs/services/secondhand-luxury-shop-cleaning.html:449>) | 網站；bot 的品牌辨識不等於真偽鑑定 |
| F37 其他完整拒收清單 | 未找到由店主定版、同時涵蓋三套系統的完整不接清單；行李箱、特殊材質及價目外項目仍須看件，待店主確認。 | 待店主確認 | [luggage-cleaning.html:367](<C:/Users/cyc39/Documents/New project 5/docs/services/luggage-cleaning.html:367>)；[conversation.py:873](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:873>)；[B1-shop-facts.md:13](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:13>) | bot／圖文／網站 |

## 材質與風險提醒

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F38 收件前看洗標與材質 | 先確認材質、洗標與限制；無標／糊標需記處理方式與依據，不能只靠照片保證洗法安全。 | 來源一致 | [Vault/收件檢查表-v1.csv:1](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/收件檢查表-v1.csv:1>)；[conversation.py:906](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:906>)；[Clothing_Memory.md:98](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:98>) | bot／網站；現場收件／圖文風險說明 |
| F39 瑕疵、口袋與配件存證 | 收件先檢查外觀、污漬、配件與清空口袋，拍整體及瑕疵照；漆皮、特殊塗層、開膠需備註並告知。只記作業規則。 | 來源一致 | [Vault/私享家-開店到關店SOP-v1.1.md:111](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:111>)；[Vault/私享家-開店到關店SOP-v1.1.md:113](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:113>)；[Vault/私享家-開店到關店SOP-v1.1.md:123](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:123>)；[Vault/收件檢查表-v1.csv:1](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/收件檢查表-v1.csv:1>) | 現場收件；bot／圖文／網站可據此說明 |
| F40 麂皮與異材質風險 | 麂皮泡水可能硬化、掉色；拼接材質分區評估，不直接承諾整件同法處理。此為來源中的風險提醒，未驗證特定設備／藥劑。 | 來源一致 | [Memory.md:28](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Memory.md:28>)；[Clothing_Memory.md:57](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:57>)；[Dialog_Phrases.json:106](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:106>) | bot／圖文／網站 |
| F41 PU／人造皮老化 | 水解、起泡、龜裂與脫皮屬既有老化風險，清潔不能當作修復承諾。 | 來源一致 | [Clothing_Memory.md:66](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:66>)；[Dialog_Phrases.json:517](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:517>) | bot／網站；圖文可沿用風險邊界 |
| F42 泛黃、磨耗與補色界線 | 膠邊氧化與磨耗不等於表面髒污，清潔不保證回白或變全新；補色、修補另評估。 | 來源一致 | [shoe-bag-care.html:575](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:575>)；[shoe-bag-care.html:953](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:953>)；[contentPlan.ts:764](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:764>) | bot 需對齊／圖文／網站 |
| F43 厚件乾透再收納 | 表面乾不等於內層乾；厚處、填充與濕氣要確認，羽絨未乾不壓入真空袋。 | 來源一致 | [contentPlan.ts:746](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:746>)；[contentPlan.ts:801](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:801>)；[fabric-storage.html:696](<C:/Users/cyc39/Documents/New project 5/docs/services/fabric-storage.html:696>) | 圖文／網站；bot 知識須按材質評估 |
| F44 洗淨、不受損與除臭承諾 | 網站／舊 bot 限縮效果保證，kit 語料仍有不傷衣服、徹底殺菌除味等說法；不能視作已驗效果，見 C10。 | 來源衝突 | [dialog_corpus.py:575](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:575>)；[Dialog_Phrases.json:557](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:557>)；[conversation.py:906](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:906>)；[shoe-bag-care.html:1126](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:1126>) | bot／圖文／網站 |
| F45 自行處理污漬的提醒 | 先說明已用過哪些清潔品；特殊污漬避免自行倒酒精、去光水或大力刮扯，請師傅看材質。未把語料的特定化學工法當成已查證的門市設備。 | 來源一致 | [Dialog_Phrases.json:100](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:100>)；[chat_service.py:115](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:115>)；[conversation.py:907](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:907>) | bot／圖文／網站 |

## 付款方式

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F46 kit 線上付款模式 | 本機 payment.mode=disabled，payment.url 為空且 environment=sandbox；只能證明此設定檔未選付款模式，不能推論門市櫃台不收任何支付。 | 來源一致 | [shop.json:93](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:93>)；[line_pay.py:147](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/line_pay.py:147>)；[line_pay.py:152](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/line_pay.py:152>) | bot kit 設定；門市實際方式另確認 |
| F47 可對外承諾的支付方式 | kit 語料肯定 LINE Pay、刷卡、現金、轉帳及街口；舊 bot 要店員確認現金／刷卡等。門市實際支援與付款入口待店主確認，見 C09。 | 來源衝突 | [Dialog_Phrases.json:351](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:351>)；[Dialog_Phrases.json:365](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:365>)；[conversation.py:1028](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1028>)；[conversation.py:1029](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1029>) | bot；圖文／網站未建立同一已確認清單 |
| F48 預估價與付款時點 | 舊 bot 說預估價先不用付，待店員看件確認金額；LINE Pay 需由客人確認店家與金額後自行輸入。僅記既有規則，不提供付款連結。 | 來源一致 | [quote_flow.py:231](<C:/Users/cyc39/Documents/New project 5/line-bot/quote_flow.py:231>)；[conversation.py:2579](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2579>)；[conversation.py:2580](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2580>) | 舊 bot 對照；kit／網站應核對再承諾 |
| F49 客人說已付／上傳付款畫面 | 交櫃台核對交易紀錄；不能憑訊息或截圖自行標成已付款，也不能由 AI 終裁退款或賠償。 | 來源一致 | [conversation.py:459](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:459>)；[conversation.py:492](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:492>)；[Vault/02_已決定規格.md:46](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:46>)；[Vault/02_已決定規格.md:49](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:49>) | 舊 bot；Smart-Laundry-AI 規格作邊界參考 |
| F50 發票、載具、會員儲值紅利、公司月結 | 語料有肯定說法；未找到店主本次確認或 kit 驗收證據。各項是否提供與限制待店主確認。 | 待店主確認 | [Dialog_Phrases.json:357](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:357>)；[Dialog_Phrases.json:358](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:358>)；[Dialog_Phrases.json:359](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:359>)；[Dialog_Phrases.json:367](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:367>)；[conversation.py:1036](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1036>) | bot；圖文／網站不得直接推定 |
| F51 保管費 | SOP v1.1 明定自動加收保管費已取消；不把語料的出國免費保管擴張為無期限免費保管承諾。 | 來源一致 | [Vault/私享家-開店到關店SOP-v1.1.md:38](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:38>)；[Dialog_Phrases.json:385](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:385>) | 門市 SOP／bot 語料；網站未找到完整保管條款 |

## 查件與綁定規則

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F52 查件輸入類型 | kit 程式有完整手機／市話及門市客號查詢；舊 bot 引導完整手機或收據洗號。格式支援不同不表示身分授權已驗收。 | 來源一致 | [lookup_service.py:53](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:53>)；[webhook_server.py:642](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:642>)；[webhook_server.py:655](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:655>)；[conversation.py:2312](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2312>) | bot；圖文／網站未見同一查件功能規格 |
| F53 首次查到後的綁定行為 | kit 路由查到電話或客號後會呼叫 save_binding，關聯 LINE user_id 與客號；舊 bot 也有 bind_uid。實際允許誰查誰、是否需另驗證，待店主確認；本次未查任何客戶資料。 | 待店主確認 | [webhook_server.py:649](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:649>)；[webhook_server.py:668](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:668>)；[conversation.py:2328](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2328>)；[shop.json:120](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:120>) | bot kit／舊 bot 對照 |
| F54 綁定後再次查件 | kit 優先使用已綁客號查詢；舊 bot 已綁定時直接回該客號狀態，並避免每次重複群通知。此為本機程式行為，非店機實測。 | 來源一致 | [webhook_server.py:675](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:675>)；[conversation.py:2305](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2305>) | bot |
| F55 查件顯示範圍 | kit 格式化程式區分可取件與處理中物件，另有帳務欄位；只記欄位／狀態設計，不抄任何客人明細或金額。 | 來源一致 | [lookup_service.py:322](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:322>)；[lookup_service.py:332](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:332>)；[lookup_service.py:340](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:340>)；[Dialog_Phrases.json:376](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:376>) | bot |
| F56 資料不可用時 | lookup_service 在 snapshot 不可用時回 manual_required，請門市人工確認；舊 bot 自動查件不可用時改問櫃台。不得沿用舊狀態假裝即時。 | 來源一致 | [lookup_service.py:69](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:69>)；[lookup_service.py:73](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/lookup_service.py:73>)；[conversation.py:2271](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2271>) | bot |
| F57 查件速度、同步頻率與取件推播 | 語料聲稱一秒查件、每五分鐘同步、全天候及主動推播；shop.json 只設 max_age_seconds=300。時效、實際同步及通知成功皆未量測，待店主確認，不把資料期限當成排程證明。 | 待店主確認 | [Dialog_Phrases.json:374](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:374>)；[Dialog_Phrases.json:377](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:377>)；[Dialog_Phrases.json:393](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:393>)；[shop.json:85](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:85>) | bot；圖文／網站若要宣稱須另有證據 |
| F58 查件授權與手機驗收 | 本機 query_authorization_tested、real_phone_tested 為 false；完整的本人驗證／換綁／解除綁定政策未找到已確認版本，待店主確認。 | 待店主確認 | [shop.json:116](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:116>)；[shop.json:120](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:120>)；[webhook_server.py:134](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:134>) | bot；未連店機、未驗手機 |

## 人工接手條件

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F59 舊 bot 的真人要求與非營業時間 | 預設文字為轉店裡、由店員接著回；打烊則等營業時間處理。未據此承諾回覆分鐘數或通知已送達。 | 來源一致 | [conversation.py:152](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:152>)；[conversation.py:911](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:911>) | 舊 bot 對照；kit 實際轉接見 F63 |
| F60 客訴、少件、拿錯、洗損與賠償 | 交店員處理，不能讓估價或一般 FAQ 自行判責／結案；Smart-Laundry-AI 規格亦保留人類最終決定。 | 來源一致 | [conversation.py:1020](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1020>)；[conversation.py:886](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:886>)；[Vault/02_已決定規格.md:49](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:49>) | 舊 bot／Smart-Laundry-AI 規格；kit 待核對 |
| F61 低信心照片與特殊／無洗標物件 | 舊 bot 低信心照片交店員，不硬猜；Smart-Laundry-AI 的影子規格對特殊皮件、無洗標、低信心與真偽議題要求拒判。研究規格未當作 kit 已實作。 | 來源一致 | [quote_flow.py:198](<C:/Users/cyc39/Documents/New project 5/line-bot/quote_flow.py:198>)；[quote_flow.py:203](<C:/Users/cyc39/Documents/New project 5/line-bot/quote_flow.py:203>)；[Vault/02_已決定規格.md:51](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:51>) | 舊 bot；Smart-Laundry-AI 僅作規格參考 |
| F62 未知服務、優惠與其他未列項目 | 舊 bot 明寫不先回答有提供，先交門市確認；不能因為價格／服務關鍵字匹配就當成已提供。 | 來源一致 | [conversation.py:873](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:873>)；[conversation.py:877](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:877>)；[conversation.py:1036](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1036>) | 舊 bot 對照；圖文／網站須遵守不編造 |
| F63 kit 真人接手是否真的送到人 | shop.json 列 staff_handoff，但 webhook 一般文字末路由仍交 generate_chat_reply；在本次讀到的路由未找到明確真人接手送達證據。條件、接收人與回覆時限待店主確認。 | 待店主確認 | [shop.json:106](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:106>)；[webhook_server.py:781](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:781>)；[shop.json:119](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:119>) | bot kit；僅靜態查閱 |

## 隱私與照片保留

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F64 影像同意設定 | 本機 vision.enabled=true、consent_required=true，條款版本 2026-09-v1；只是設定，不能證明客人已實際同意。 | 來源一致 | [shop.json:87](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:87>)；[shop_config.py:350](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop_config.py:350>) | bot kit 設定 |
| F65 實際同意告知與影像驗收 | webhook 圖片分支直接下載並交辨識；在此分支未找到同意判斷。photo_tested 為 false；實際告知、拒絕與撤回方式待店主確認。 | 待店主確認 | [webhook_server.py:627](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/webhook_server.py:627>)；[shop.json:117](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:117>)；[shop.json:91](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:91>) | bot kit；未傳照片或呼叫模型 |
| F66 照片保留天數 | shop.json 設 photo_retention_days=7；未找到能證明原始照片七天後刪除的執行／驗收證據。保留對象、起算點、備份刪除與門市存證照片期限待店主確認。 | 待店主確認 | [shop.json:110](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:110>)；[Vault/私享家-開店到關店SOP-v1.1.md:113](<C:/Users/cyc39/Documents/AI-Agent-Vault/08-Knowledge/Approved/私享家-開店到關店SOP-v1.1/私享家-開店到關店SOP-v1.1.md:113>)；[shop.json:117](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:117>) | bot kit 設定／現場存證；圖文／網站未見一致條款 |
| F67 照片對話記憶與照片本體分開 | photo_session 預設只讀一小時內的記憶，寫入新 session 時篩掉超過二十四小時的舊記憶；這不是原始照片保留期限，也不是定時全量刪除證明。 | 來源一致 | [photo_session.py:40](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/photo_session.py:40>)；[photo_session.py:51](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/photo_session.py:51>)；[photo_session.py:60](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/photo_session.py:60>) | bot kit；未讀 session 資料檔 |
| F68 研究資料層的個資與原始照片邊界 | Smart-Laundry-AI 的研究資料規格不存姓名、電話、地址、LINE 對話或照片等，原始照片不得進 Vault、git、社群 repo 或申請附件。此為該研究資料層邊界，不推定營運綁定資料已去識別。 | 來源一致 | [Vault/02_已決定規格.md:78](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:78>)；[Vault/02_已決定規格.md:82](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:82>) | Smart-Laundry-AI 規格；供 bot／圖文／網站協作參考 |
| F69 研究用途同意紀錄 | 該規格要求獨立保存目的、條款版本、時間、方式與證據；案件勾選不是同意證明。本次未找到 kit 對此完成實機驗收的資料。 | 待店主確認 | [Vault/02_已決定規格.md:79](<C:/Users/cyc39/Documents/AI-Agent-Vault/03-Projects/Smart-Laundry-AI/02_已決定規格.md:79>)；[shop.json:117](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:117>) | Smart-Laundry-AI 規格／bot kit 待確認 |

## 品牌語氣與禁語

| 事實 | 目前值 | 狀態 | 來源(檔名:行號) | 哪些系統在用 |
|---|---|---|---|---|
| F70 對客語氣 | 成熟、專業、親切、精簡，回答當前問題再給自然下一步；避免浮誇助詞、制式罐頭與無關廣告。 | 來源一致 | [chat_service.py:101](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:101>)；[chat_service.py:102](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:102>)；[chat_service.py:104](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:104>)；[dialog_corpus.py:4](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:4>) | bot；圖文／網站以實際看件與界線說明對照 |
| F71 回覆長度的適用情境 | 文字聊天 prompt 要求一至二句；衣物照片知識庫要求四個自然段落，屬不同輸出情境。是否仍採兩種規則待店主確認，不把它們直接判作同一情境的矛盾。 | 待店主確認 | [chat_service.py:105](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:105>)；[Clothing_Memory.md:93](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Clothing_Memory.md:93>) | bot 文字／照片；圖文／網站另有版面規格 |
| F72 價格禁語 | 不寫價格，除非店主當次給；本檔只記分類與品名，既有自動帶價與公開價目內容的落差見 C05。 | 店主已定 | [B1-shop-facts.md:11](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:11>)；[contentPlan.ts:1830](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1830>)；[chat_service.py:108](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:108>) | bot／圖文／網站皆應依當次授權 |
| F73 生成標示 | 不標示「AI 生成」。本機網站與產站來源仍有此標示，見 C11；本卡只登記，不改網站。 | 店主已定 | [B1-shop-facts.md:12](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:12>)；[shoe-bag-care.html:394](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:394>)；[generatePublicSite.ts:550](<C:/Users/cyc39/Documents/New project 5/src/generatePublicSite.ts:550>) | bot／圖文／網站 |
| F74 客件與案例真實性 | 不冒充真實客件，不編造案例。寫實圖像風格、人物錨或固定來源字串都不能作為真實客件證明。 | 店主已定 | [B1-shop-facts.md:12](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:12>)；[persona-master.md:3](<C:/Users/cyc39/Documents/New project 5/data/persona-master.md:3>)；[contentPlan.ts:1792](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1792>) | bot／圖文／網站 |
| F75 自動來源字串與第一人稱經驗 | 圖文程式會加「出處：門市當日看件」，另有「這幾個月我遇到最多」文句；未找到對應當日看件證據。是否符合實況待店主確認，不在本卡斷言造假。 | 待店主確認 | [contentPlan.ts:1792](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1792>)；[contentPlan.ts:1804](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1804>)；[contentPlan.ts:794](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:794>)；[B1-shop-facts.md:12](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:12>) | 圖文；bot／網站不可據此當真實案例 |
| F76 數字與成效 | 不編造數字、成效；未量測的洗淨、同步速度、詢問／營收成效不得寫成已證實。 | 店主已定 | [B1-shop-facts.md:12](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:12>)；[Dialog_Phrases.json:393](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:393>) | bot／圖文／網站 |
| F77 不確定資訊的處理 | 不確定的一律標「待店主確認」；找不到寫「未找到」，不自行補店務承諾。 | 店主已定 | [B1-shop-facts.md:13](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:13>) | bot／圖文／網站；本檔逐條標狀態 |

## 店主拍板（2026-10-30 晚，C01–C11）

這一節的效力高於下方衝突清單的「待店主確認」。三套系統以這裡為準修正：店機 bot 和 ai bot 由 B1-2 卡處理，圖文管線用詞由 B1-3 卡處理。

| # | 拍板 | 對客說法 |
|---|---|---|
| C01 | A | 一般衣物 5–7 天（單位是「天」，不是工作天） |
| C02 | A | 鞋 7 天（皮鞋保養也一樣，不另外算） |
| C03 | A | 厚棉被、羽絨被、地毯這類難乾的大件 10–14 天；薄被單、床單、枕套算一般衣物，5–7 天 |
| C04 | A | 包、皮件、小皮件（皮夾）都是 14 天 |
| C05 | C 維持現狀 | 圖文 withPriceLine、店機 bot 價目參考、網站參考價都不動 |
| C06 | A | 收送沒有低消、一件也收 |
| C07 | A | 「台中市免費到府收送」（不說市區、不說全區或全市） |
| C08 | A | 「營業時間內約，當天時段由店裡回覆」（店機 shop.json 的 pickup.slots 只是設定，不對客顯示，不改） |
| C09 | 店主寫 | 付款方式：現金、LINE Pay、轉帳（不說信用卡、刷卡、街口） |
| C10 | A | 「看件後說可改善範圍，不保證」 |
| C11 | B 保留 | 網站三頁主圖圖說維持現狀 |

其他品項（皮衣、窗簾、娃娃等）沒有定交期，對客說「看件後店裡跟您說交期」。這幾項的天數「待店主確認」。

## 衝突清單

共 11 組。以下引文保留來源原字（包含原文用字與程式識別字）；不引用任何價格數字或客戶個案。C07 是用詞差異，C05、C09 同時涉及授權／承諾範圍，不據此虛構實際營運行為。

### C01 一般衣物交期

- **店主已定 原文**：「一般衣物 5–7 天」— [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)。
- **kit 語料 原文**：「一般日常衣物與西裝清洗約需 3 到 4 個工作天」— [Dialog_Phrases.json:61](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:61>)。
- **kit 聊天 prompt 原文**：「一般衣物約 3~4 天」— [chat_service.py:112](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:112>)。
- **舊 bot 原文**：「一般件三到五天，名牌、皮革會再久一點。」— [conversation.py:851](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:851>)。

判讀：以本卡 5–7 天為準；天數與工作天單位均不同。只登記差異，未改三套系統。

### C02 鞋類交期與泛用照片備援

- **店主已定 原文**：「鞋 7 天」— [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)。
- **網站已對齊 原文**：「鞋類交期為 7 天。」— [white-shoe-cleaning.html:576](<C:/Users/cyc39/Documents/New project 5/docs/services/white-shoe-cleaning.html:576>)。
- **kit 語料 原文**：「工期約需 5 到 7 個工作天。」— [Dialog_Phrases.json:62](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:62>)。
- **kit 鞋類知識 原文**：「說明洗鞋需 5~7 個工作天」— [Memory.md:52](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Memory.md:52>)。
- **kit 細分語料 原文**：「皮鞋深層保養上油約需 4 到 5 個工作天」— [Dialog_Phrases.json:89](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:89>)。
- **kit 泛用照片備援 原文**：「這件{cat}一般約 3~4 個工作天。」— [chat_service.py:195](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:195>)。

判讀：以本卡 7 天為準；不得把工作天默認等同天，也不能把泛用照片回覆當成鞋類已定交期。

### C03 難乾的大件交期

- **店主已定 原文**：「難乾的大件 10–14 天」— [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)。
- **kit 語料 原文**：「大件被單與厚棉被洗滌約需 3 到 4 個工作天」— [Dialog_Phrases.json:64](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:64>)。
- **kit 聊天 prompt 原文**：「床組棉被約 3~4 天。」— [chat_service.py:112](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:112>)。

判讀：難乾的大件以 10–14 天為準；是否屬難乾大件需看件。沒有把所有薄被、床單都歸入此類。

### C04 皮件包交期

- **店主已定 原文**：「皮件包 14 天」— [B1-shop-facts.md:10](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:10>)。
- **網站已對齊 原文**：「皮件與包類交期為 14 天。」— [luxury-bag-cleaning.html:493](<C:/Users/cyc39/Documents/New project 5/docs/services/luxury-bag-cleaning.html:493>)。
- **kit 鞋包合併語料 原文**：「鞋類與包包因需手工拆解細刷」— [Dialog_Phrases.json:62](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:62>)。
- **kit 精品皮件語料 原文**：「工期約需 7 到 10 個工作天細緻照護。」— [Dialog_Phrases.json:67](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:67>)。
- **kit 小皮件語料 原文**：「皮夾與名牌小皮件保養約需 5 到 7 個工作天」— [Dialog_Phrases.json:79](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:79>)。

判讀：皮件包以本卡 14 天為準；原鞋包共用句不能作統一交期。皮衣等其他細分類仍待店主確認適用範圍。

### C05 當次給價硬規則與自動帶價設計

- **店主已定 原文**：「價格:不寫,除非店主當次給。」— [B1-shop-facts.md:11](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:11>)。
- **圖文程式 原文**：「withPriceLine(withLineContact(caption, tracking), topic)」— [contentPlan.ts:1830](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:1830>)。
- **kit 聊天 prompt 原文**：「現役價目參考：{prices_str}」— [chat_service.py:108](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/runtime/chat_service.py:108>)。
- **網站既有價目位置 原文**：「一般運動鞋水洗參考價」— [shoe-bag-care.html:406](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:406>)。

判讀：本檔不抄任何價格數字。既有程式與頁面含自動／公開帶價設計，需另核實每次給價授權；本次沒有證明哪次發布是否違反當次授權，也未修改既有價格。

### C06 收送滿額門檻

- **kit JSON 語料 原文**：「台中市區提供滿額專人收送服務。」— [Dialog_Phrases.json:324](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:324>)。
- **kit 執行語料 原文**：「台中市區提供滿額專人收送服務。」— [dialog_corpus.py:315](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:315>)。
- **圖文 原文**：「台中市區免費到府收送，沒有低消、一件也收」— [contentPlan.ts:849](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:849>)。
- **網站 原文**：「收送沒有最低消費門檻。」— [taichung-citywide-laundry-pickup.html:677](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:677>)。

判讀：滿額與無最低消費直接不一致；門檻待店主確認。本次不替店主增設或取消條件，也不抄任何門檻金額。

### C07 收送範圍的市區／全市用詞

- **kit 語料 原文**：「外收外送服務主要配合市區車趟排程」— [Dialog_Phrases.json:327](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:327>)。
- **圖文部分模板 原文**：「台中市區免費到府收送」— [contentPlan.ts:555](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:555>)。
- **圖文另一模板 原文**：「台中全區免費到府收」— [contentPlan.ts:826](<C:/Users/cyc39/Documents/New project 5/src/contentPlan.ts:826>)。
- **網站 原文**：「收送範圍為台中市全市」— [taichung-citywide-laundry-pickup.html:665](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:665>)。

判讀：這是範圍口徑差異；「市區」本身不能證明拒收其他行政區。實際涵蓋區域及對客統一用詞待店主確認，不把用詞差異誇大成已證實的拒收行為。

### C08 固定收送窗口與營業時間

- **kit 平日設定一 原文**：「10:00-12:00」— [shop.json:56](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:56>)。
- **kit 平日設定二 原文**：「14:00-17:00」— [shop.json:57](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:57>)。
- **kit 週六設定 原文**：「12:00-15:00」— [shop.json:60](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:60>)。
- **舊 bot 原文**：「收送時間跟營業時間一樣」— [conversation.py:2261](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:2261>)。
- **網站流程 原文**：「營業時間 10:00–20:00 內約定」— [taichung-citywide-laundry-pickup.html:673](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:673>)。
- **網站同頁 原文**：「實際可收時段由門市看過照片後在 LINE 回覆」— [taichung-citywide-laundry-pickup.html:665](<C:/Users/cyc39/Documents/New project 5/docs/services/taichung-citywide-laundry-pickup.html:665>)。

判讀：設定的窄時段、營業時間與依當下安排不是同一個可對外保證的窗口。週六營業另為 12:00–18:00；最終收送窗口待店主確認，不能把一般營業時間直接當車趟。

### C09 支付方式的肯定承諾與先問店員

- **kit 語料 原文**：「門市支援 LINE Pay、各大信用卡、現金支付與轉帳」— [Dialog_Phrases.json:351](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:351>)。
- **kit 其他支付 原文**：「街口支付亦支援使用」— [Dialog_Phrases.json:365](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:365>)。
- **舊 bot 原文**：「現金、刷卡或收據需求，請讓店員依現場告訴你；預估價先不用付。」— [conversation.py:1029](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:1029>)。
- **kit 線上付款設定 原文**：「"mode": "disabled"」— [shop.json:94](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/shop.json:94>)。

判讀：支付方式的承諾程度不一致，實際支援待店主確認。disabled 只描述 kit 線上付款模式，不能用來證明櫃台沒有現金／信用卡，亦未測刷卡、LINE Pay 或轉帳。

### C10 洗護結果與不受損／除臭保證

- **kit 語料 原文**：「兩全其美不傷衣服」— [dialog_corpus.py:575](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/dialog_corpus.py:575>)。
- **kit 被件語料 原文**：「大槽酵素高溫洗程能彻底殺菌除味」— [Dialog_Phrases.json:557](<C:/Users/cyc39/Documents/New project 5/shop-pc/fxwash/config/Dialog_Phrases.json:557>)。
- **舊 bot 原文**：「這個要看材質和實際狀況，光用文字我不敢跟你保證。」— [conversation.py:906](<C:/Users/cyc39/Documents/New project 5/line-bot/conversation.py:906>)。
- **網站 原文**：「不會保證除臭，也不保證變全新。」— [shoe-bag-care.html:1126](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:1126>)。

判讀：語料的廣泛效果承諾與看件後只說可改善範圍的原則不同，待店主確認並統一。本次未驗證藥劑、設備、殺菌或除臭效果；一般殺菌字樣不等同提供醫療滅菌。

### C11 對客 AI 生成標示

- **店主已定 原文**：「不標示「AI 生成」」— [B1-shop-facts.md:12](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/B1-shop-facts.md:12>)。
- **網站鞋包主圖 原文**：「AI 生成的高擬真產品風格主圖」— [shoe-bag-care.html:394](<C:/Users/cyc39/Documents/New project 5/docs/services/shoe-bag-care.html:394>)。
- **網站白鞋主圖 原文**：「AI 生成的高擬真產品風格主圖」— [white-shoe-cleaning.html:395](<C:/Users/cyc39/Documents/New project 5/docs/services/white-shoe-cleaning.html:395>)。
- **網站布品主圖 原文**：「AI 生成的高擬真產品風格主圖」— [fabric-storage.html:395](<C:/Users/cyc39/Documents/New project 5/docs/services/fabric-storage.html:395>)。
- **產站程式 原文**：「AI 生成的高擬真產品風格主圖」— [generatePublicSite.ts:550](<C:/Users/cyc39/Documents/New project 5/src/generatePublicSite.ts:550>)。

判讀：與本卡不標示 AI 生成的硬規則直接不同；本卡只列原文，沒有修改或重新生成網站。禁止冒充真實客件的另一條規則仍同時適用。
