# APK 整合邊界（2026-07-20）

## 現況

目前工作區是：

`C:\Users\cyc39\Documents\New project 5`

在本工作區尚未找到可確認為目標 APK 專案的 Android 工程入口，例如 `settings.gradle`、`settings.gradle.kts`、`AndroidManifest.xml` 或目標 app module。

## 結論

- 本輪只建立影片研究、劇本、生成前閘門、逐幀驗證與 Agent 資格資產。
- 沒有把上述能力寫入、打包進、部署到或聲稱已整合任何 APK。
- `npm test`、TypeScript typecheck 或本工作區網頁程式通過，也不能證明 APK 已整合。

## 放行條件

只有取得使用者明確指定的 APK 專案路徑後，才能：

1. 讀取該專案最接近的 `AGENTS.md` 與建置規則。
2. 確認實際 app module、branch、dirty worktree 與依賴。
3. 定義影片知識包、驗證工具或工作流要整合到 APK 的哪個可觀察介面。
4. 以該 APK 專案自己的 build、test、簽章與裝置驗證作為完成證據。

在以上條件成立前，APK 整合狀態固定為 `NOT_STARTED_PATH_REQUIRED`。

