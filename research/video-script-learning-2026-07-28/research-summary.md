# 私享家每日短影音劇本研究收斂

研究期間：2025-07-28 至 2026-07-28

## 判決

影片品質不能靠把提示詞寫長。穩定做法是「前三秒價值主張、單一可拍動作、短原片、後製補節奏、同一輪只測一個變數」。

## 已採用規則

1. 第一幀同時具備物件、衝突與可辨識動作起點；TTS 第一短句直接說明物件可以送洗。
2. Grok 原片固定 6 秒，每鏡只做一個主要動作；物件數量、手指、提把、縫線、重量與接觸陰影寫成硬限制。
3. 12 秒成片的動態標題、局部放大、四圖蒙太奇、繁中 TTS、音效與 CTA 全部後製，不要求生成模型一次完成。
4. 每個腳本先產三個 hook，但同一輪的 body、動作、TTS 後半與 CTA 保持不變，避免無法歸因。
5. Grok 成片先做完整解碼與物理複審，Sol 再做腳本、誇大、連續性與發布 Gate 複審；任一 FAIL 就不發布。
6. 發布滿 72 小時後，只用實際 reach、views、saves、shares、LINE clicks、inquiries、bookings 決定下一輪；缺值保留 null。

## 官方依據

- Meta Reels：9:16、音訊與關鍵訊息安全區。  
  https://www.facebook.com/business/ads/facebook-instagram-reels-ads
- TikTok Business：前三秒交代內容主張，使用 hook、body、CTA。  
  https://ads.tiktok.com/help/article/creative-best-practices
- xAI Video 1.5：支援 image-to-video、解析度與時間控制；Fast 路線為 6 秒 720p。  
  https://x.ai/news/grok-imagine-video-1-5
- YouTube：以 audience retention、engaged views 與 viewed-versus-swiped-away 比較同格式內容。  
  https://support.google.com/youtube/answer/12942217

## X 社群方法

以下只作測試設計參考，不視為成效保證：

- 聲音、字幕、視覺三層 hook：https://x.com/betterwithalina/status/2081065398695592105
- 同腳本只換 hook：https://x.com/KatieHaleUGC/status/2026357239834095756
- 一次只改 hook，避免混淆變數：https://x.com/generatedbyann/status/2081759693563977870
- 固定腳本後批次換 hook 字卡：https://x.com/maxxmalist/status/2077135874509467899
- 週期性拆解 winner 與 loser：https://x.com/DTCMidas/status/1961055913705349481

## 私享家每日淘汰條件

- hook 超過 18 個非空白字，或前三秒仍不知道在說什麼。
- 抽象動作，如「處理物件」「展示效果」，沒有可拍攝的物件與方向。
- 一鏡同時要求拿取、轉身、交接、說話、關門等多個動作。
- 人物、頭部、手指、鞋子、提把、門框、牆面或袋子出現穿模或數量漂移。
- 使用 Grok 原音、TTS 聽不懂、字幕超出安全區。
- 假清潔成果、假案例、假顧客見證或無證據 before/after。
- 沒有 Grok 複審、Sol 複審或明確發布核准。
