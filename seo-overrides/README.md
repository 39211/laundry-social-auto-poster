# SEO Overrides

這個目錄包含手動維護的 SEO 優化頁面，直接從 39211.github.io 提取。

## 用途

生成器在完成正常生成後，會將這些文件逐字複製到輸出目錄（`docs/`），覆蓋自動生成的版本。這確保了 PR #7、#8、#9 的 SEO 改進（answer boxes、FAQs、內部鏈接）得以保留，而不需要在 TypeScript 中手動移植數百個 FAQ 項目。

## 內容

- **guides/** - 指南頁面（含西屯／洗鞋選擇、皮衣發霉）
- **hubs/** - 主題樞紐頁面（5 個：bag-care、luxury-garment-care、shoe-care、bedding-textile-care、local-pickup）
- **local/** - 本地/地區頁面（6 個）
- **about/** - 店家辨識頁（台中西屯唯一門市）
- **services/** - 服務頁面（含羽絨外套、精品衣、窗簾地毯、絨毛娃娃）
- **knowledge/index.html** - 知識中心首頁
- **index.html** - 網站首頁
- **llms.txt** - AI discovery 文件
- **.well-known/llms.txt** - AI discovery well-known 文件
- **price-list.html** - 價目表 stub（noindex）
- **sitemap.xml** - 網站地圖
- **business-profile.json** - 商家資料
- **answers.json** - 問答資料
- **ai-discovery.json** - AI 發現資料

## 編輯政策

**如需編輯這些頁面的 SEO 內容（Title、H1、FAQ、內部鏈接等），請直接編輯此目錄中的 HTML 文件。**

不要在 `src/generatePublicSite.ts` 中修改這些頁面的定義，因為它們會被覆蓋。

## 來源

這些文件提取自 39211/39211.github.io 在 commit `fe15ba99`（2026-09-24），包含了所有 PR #7、#8、#9、#11 的 SEO 改進。

## 驗證

`npm test` 包含一個測試，確保每個 override 文件在生成後與源文件逐字節相同。

## 2026-09-25 第一批意圖頁

新增洗鞋、寢具布品、各區收送三個 hub，以及羽絨外套、精品衣、窗簾地毯、絨毛娃娃服務頁、西屯／洗鞋選擇指南、皮衣發霉指南、台中西屯唯一門市辨識頁。價格只引用 `data/prices.json`。窗簾地毯與絨毛娃娃不寫固定價。東海無門市。不保證變全新，不做除臭、消毒或醫療滅菌承諾。

## 2026-09-26 NAP

公開名稱：私享家洗衣店（西屯門市）。地址：台中市西屯區青海路二段365號（至善國中對面）。網站：https://sixiangjialaundry.com/ 。門市市話 04-2452-7411（+886-4-2452-7411）。LINE／手機 0968-327-653（+886-968-327-653；`line_id` 仍為 0968327653）。服務範圍：台中全市免費收送；實體門市僅西屯此一處。不要寫東海有門市，不要寫 10 公里服務圈。
