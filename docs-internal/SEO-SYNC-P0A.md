# SEO-SYNC-P0A：日更貼文收錄與首頁注入

## 本單變更

- 日更文章沿用生成器原有的厚度閘門：頁面需有公開站址、Facebook 文案達既有下限、渲染後主文達既有可見字數下限，而且文章網址不能只是重複文案的別名。通過者使用 index, follow，未通過者維持 noindex, follow。
- 可索引文章仍受人類 sitemap 的既有數量上限限制，並列入生成器的 sitemap.xml、ai-sitemap.xml 與 rss.xml。覆寫 sitemap 時，生成器會保留生成 sitemap、覆寫 sitemap 與覆寫 HTML 頁面的網址聯集。
- feed.json 和首頁貼文卡片仍以已核准的全部貼文為來源，不依厚度刪減。
- 生成器把首頁日更區塊抽成共用 renderer。套用首頁覆寫後，會在有效標記中注入同一個區塊，欄位沿用既有 HTML 跳脫。

## 正式站生效時機

本單合併後，正式站**看不到變化**；必須等部署 workflow 那一單完成。部署時目前的 pages.yml 仍會強制貼文 noindex、剔除貼文網址，並用 main 的 seo-overrides/index.html 整頁覆蓋首頁，因此本單生成器的索引與注入結果不會進入正式部署產物。

## 首頁標記

SEO desk 維護 seo-overrides/index.html 時，請在靜態「每日洗護紀錄」區塊外保留且只保留一對標記：

    <!-- SXJ:RECENT_POSTS -->
    （靜態每日貼文區塊）
    <!-- /SXJ:RECENT_POSTS -->

標記外的首頁內容會原樣保留。生成器只替換兩個標記之間的內容，標記本身會留在輸出首頁供下次注入使用。若找不到標記、標記不成對、順序錯誤或重複出現，生成器會輸出一行警告並保留覆寫首頁原始位元組，不會以生成器首頁取代整頁。

## 回退

在本工作分支回退時，可反向套用本單提交的 patch，或移除 seo-overrides/index.html 的兩個標記並還原 src/generatePublicSite.ts 的改動。回退前保留目前變更，並重新產生與檢查本機站點輸出；正式站仍由部署 workflow 決定何時生效。
