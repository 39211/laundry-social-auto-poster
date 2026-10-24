# PR #30 remote-head verification attempt（2026-08-31 16:30）

## 結果

- 目的：在獨立暫存目錄重跑 PR #30 focused／full／typecheck，不污染目前 dirty worktree。
- 使用 `git clone --filter=blob:none --no-checkout` 後 fetch `pull/30/head`；checkout 階段仍啟動多個 git 子程序去取完整工作樹資產，超過本輪允許觀測時間，沒有進入 npm 測試。
- 已用程序命令列確認是本輪 clone 的四個 git 子程序，逐一停止；`remaining=0`。
- 暫存 clone 未被用來產生測試結論；本輪沒有新增任何遠端測試 PASS／FAIL 聲稱。

## 與發布風險的關聯

這次觀察再次顯示全量工作樹／資產會讓淺克隆驗證被 646 MB 資產拖慢；因此 PR #30 的 HTML／SEO-only overlay 與 sparse publish 邊界仍需保留。此報告不代表 live 發布，也不代表 PR 已通過獨立複審。

目前 authoritative 結論仍以 GitHub CI `typecheck-and-test=success`、既有隔離 runtime report 及 PR #30 的 `REWRITE` 審查為準。

## 16:32–16:36 sparse checkout 重試

- 改用「先 sparse-checkout、再 checkout」並只取程式碼、測試、scripts、JSON fixtures、指定視覺 fixture；遠端 HEAD 確認為 `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`，工作樹約 2.76 MB。
- 初次 focused 缺少 `PUBLIC_SITE_BASE_URL` 時，3 files 中 2 files／15 tests 通過，`publicSite` 因環境變數缺失而 fail；這是測試環境設定錯誤，非 PR 判定。
- 設定 `PUBLIC_SITE_BASE_URL=https://sixiangjialaundry.com` 與 `PUBLIC_IMAGE_BASE_URL=https://sixiangjialaundry.com` 後：focused **3 files／41 tests PASS**；full **87 files／710 passed／16 skipped（726 total）**；`npx tsc --noEmit` **exit 0**；`git diff --check` **exit 0**。
- 測試使用主專案 `node_modules` junction；測試後暫存 clone 留有測試產生的 `scripts/__pycache__` 與 junction，未改動主專案依賴或來源檔。

這組結果是 PR HEAD 的獨立可重現證據，但仍只是現有測試套件通過；不會覆蓋先前 Luna 指出的 host／resolver／provenance／revision／safety gate 缺口。
