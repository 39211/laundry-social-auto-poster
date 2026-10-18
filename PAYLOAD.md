<<<PAYLOAD_BEGIN>>>
STATUS| PARTIAL
BASE| 766ada1c
HEAD| 0309421
PR| https://github.com/39211/laundry-social-auto-poster/pull/206
ITEM| 1 | PARTIAL | 11 cases; ①–⑨先紅 否（①–⑧紅；⑨基底已攔截）
ITEM| 2 | DONE | 路徑 token 掃描、內容正規化、.html/.htm 與負向邊界；11 案例修後全如預期
ITEM| 3 | DONE | URL 集合比對完整路徑段
ITEM| 4 | DONE | 精品包卡改文、docs 同步、精確文案與禁詞斷言
ITEM| 5 | DONE | 路徑 token／%2f／負向邊界三個 production mutations 各自紅；還原後 3/3 綠
ITEM| 6 | DONE | typecheck ok；兩檔 85 passed；全套 1722 passed / 1 failed / 19 skipped（唯一失敗為既有日曆槽）
ITEM| 7 | DONE | 已推送分支並更新/讀回 OPEN / Draft PR #206 r4 內文
TESTS| passed=1722 failed=1 skipped=19
NOT_DONE| Item 1 | Case 09 基底已因來源小寫化而攔截，無法在未破壞正確行為下讓它先紅。
UNSURE| 無
<<<PAYLOAD_END>>>
