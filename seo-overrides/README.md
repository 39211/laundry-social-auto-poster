# SEO Overrides

這個目錄包含手動維護的 SEO 優化頁面，直接從 39211.github.io 提取。

## 用途

生成器在完成正常生成後，會將這些文件逐字複製到輸出目錄（`docs/`），覆蓋自動生成的版本。這確保了 PR #7、#8、#9 的 SEO 改進（answer boxes、FAQs、內部鏈接）得以保留，而不需要在 TypeScript 中手動移植數百個 FAQ 項目。

## 內容

- **guides/** - 指南頁面（~46 個）
- **local/** - 本地/地區頁面（~5 個）
- **services/** - 服務頁面（~7 個）
- **knowledge/index.html** - 知識中心首頁
- **index.html** - 網站首頁
- **llms.txt** - AI discovery 文件
- **.well-known/llms.txt** - AI discovery well-known 文件
- **price-list.html** - 價目表 stub（noindex）

## 編輯政策

**如需編輯這些頁面的 SEO 內容（Title、H1、FAQ、內部鏈接等），請直接編輯此目錄中的 HTML 文件。**

不要在 `src/generatePublicSite.ts` 中修改這些頁面的定義，因為它們會被覆蓋。

## 來源

這些文件提取自 39211/39211.github.io 在 commit `0fa105a6`（2026-09-24），包含了所有 PR #7、#8、#9 的 SEO 改進。

## 驗證

`npm test` 包含一個測試，確保每個 override 文件在生成後與源文件逐字節相同。
