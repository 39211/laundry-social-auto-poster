已完成 B2 唯讀設計，**只新增指定的兩份文件**：

- [B2-DESIGN.md](C:/Users/cyc39/AI-Lanes/integ/repo/docs-internal/B2-DESIGN.md)：包含方案比較、資料流程、欄位表、對照演算法、B3 輸入契約、最小改動與部署清單，以及未知／假設。
- [B2-RESULT.md](C:/Users/cyc39/AI-Lanes/integ/repo/docs-internal/cards/B2-RESULT.md)：列出實際讀取的原碼與資料結構、查閱的 LINE 官方頁、驗證結果及未確定事項。

建議先採「**每篇內容一個來源碼，客人主動送出後記帳，再由店機本地唯讀比對收件**」。設計將卡片中的「詢問後七日」與「綁定後七日」分開定義，保留未綁定、未滿觀察窗及資料不完整的未知狀態；收件關聯也不當作付款或營收證據。

已確認 Git 僅出現這兩個新增檔，既有追蹤檔、暫存區及 HEAD 均未變；UTF-8、相對連結、Markdown 圍欄與格式檢查通過。**未改程式、未連店機、未呼叫營運 API、未發 LINE、未做 commit。**

真正的 OA ID、綁定可信度、Det 歷史完整性及人工預約確認入口仍待後續驗證；獨立設計覆核留待 Claude commander，未宣稱現場鏈路已完成。