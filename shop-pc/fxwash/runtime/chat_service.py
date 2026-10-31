"""AI Humanized Conversational Clerk Service for FXwash LINE Official Account.

Empowers the bot with warm, authentic, Taiwanese conversational tone.
Grounded in store Dco prices, hours, parking, stain handling, and turnaround time.
Seamlessly weaves in gentle guidance (photo quote, phone lookup, direct store drop-off),
persists and respects Photo Session Context for natural multi-turn follow-ups,
and falls back immediately to the expanded dialog corpus if Gemini API is unreachable.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from config import dialog_corpus
from runtime.photo_session import get_photo_session

GEMINI_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
]


def get_gemini_api_key(shop_root: Path) -> str:
    """Retrieve Gemini API key from environment or secrets/vision.json."""
    env_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if env_key:
        return env_key.strip()

    secrets_file = shop_root / "secrets" / "vision.json"
    if secrets_file.exists():
        try:
            data = json.loads(secrets_file.read_text(encoding="utf-8"))
            key = data.get("api_key") or data.get("gemini_api_key")
            if key:
                return str(key).strip()
        except Exception:
            pass
    return ""


def call_gemini_chat(user_text: str, api_key: str, shop_root: Path, user_id: str = "") -> str | None:
    """Call Gemini to generate a warm, natural, humanized Taiwanese clerk response with photo continuity."""
    prices_path = shop_root / "config" / "prices.json"
    prices_str = ""
    if prices_path.exists():
        try:
            data = json.loads(prices_path.read_text(encoding="utf-8"))
            items = []
            for cat, its in data.get("categories", {}).items():
                for it in its:
                    p = f"{it['price']}元" if it.get("price") is not None else "現場評估"
                    items.append(f"{it['name']}: {p}")
            prices_str = "、".join(items[:60])
        except Exception:
            pass

    # Retrieve recent photo session if user uploaded a photo in the last hour
    photo_context_section = ""
    if user_id:
        session = get_photo_session(shop_root, user_id, max_age_seconds=3600)
        if session:
            brand = session.get("brand", "")
            model = session.get("model", "")
            cat = session.get("category", "")
            price = session.get("price", "")
            mat = session.get("material", "")
            stain = session.get("stain_detected", "")
            q_asked = session.get("question_asked", "")
            notes = session.get("notes", "")

            photo_context_section = (
                "\n【🌟 顧客剛剛傳送之照片診斷記憶（極為重要，顧客現在的回話是在回覆此事件）】：\n"
                f"- 物品款式：{brand} {model}（分類：{cat}，材質：{mat}）\n"
                f"- 門市估價：{price} 元\n"
                f"- 洗滌工法：{notes}\n"
            )
            if stain:
                photo_context_section += f"- 觀察到的污漬/狀況：{stain}\n"
            if q_asked:
                photo_context_section += f"- 專員剛剛向顧客提出的引導問題：『{q_asked}』\n"
            photo_context_section += (
                "⚠️ 指示：顧客目前的文字訊息很可能是延續上述照片的回答（例如回答污漬時間、詢問是否洗得掉、清洗天數、確認送洗或洗標）。"
                "請像店內同一位資深師傅一樣，完全掌握該物件與污漬脈絡，親切、自然、具體地回應，並在結尾引導客人免預約送至門市！\n"
            )

    system_prompt = (
        "你是台灣台中市「私享家專業洗衣」的資深門市專員與專業洗衣顧問。\n"
        "你正在 LINE 官方帳號上為顧客提供專業、可靠、親切且得體的洗滌諮詢。\n\n"
        "【說話風格與引導式原則（極為重要，必須嚴格遵守）】\n"
        "1. 引導式真人互動原則：你的回話必須像店內資深師傅或店長在門市面對面親切招待客人一樣，有問必答，並在結尾自然帶出專屬的「下一步行動引導（Guiding Action）」：\n"
        "   - 若客人詢問特殊污漬/名牌衣物/皮革包鞋/洗損救援：解說專業原理後，引導「若方便的話您可以先拍張清楚的局部照傳過來，我先幫您評估看看～」\n"
        "   - 若客人詢問清洗天數/急件/出差面試：說明標準時效後，引導「如果您這兩天急著穿，送來門市時跟師傅講一聲，我們現場幫您協調急件插單排程！」\n"
        "   - 若客人詢問門市送洗/大件被單/整批衣服：說明費用後，引導「營業時間免預約直接帶過來就可以囉，門市在至善國中正對面，門口路面寬敞超好停車，搬運非常方便！」\n"
        "   - 若客人詢問衣服洗好了沒/查進度：引導「您只要直接在對話框輸入您的『手機號碼』（例如 0912345678），系統 1 秒鐘就會列出您所有衣物的洗滌進度喔！」\n"
        "   - 若客人詢問衣服能不能救（如縮水、油漆、除味）：引導「只要還沒自己用熱水或漂白水洗過，通常有機會改善，師傅看件後會說明可改善的範圍，不保證；營業時間隨時直接拿來門市讓師傅現場摸摸材質最準確！」\n"
        "2. 專業沉穩、得體親切：用語成熟洗鍊，具備專業洗衣師傅與資深門市主管的專業信賴感。自然禮貌（如「您好」、「請放心」、「沒問題的」、「謝謝您」）。\n"
        "3. 嚴禁浮誇口吻與多餘助詞：嚴格禁止使用「哎呀、哈哈、吼、拍謝啦、包在我們身上」等過度輕浮造作的口語！不自稱「小幫手」，而是以門市專員的身分專業應答。\n"
        "4. 嚴禁機械化罐頭：絕對不使用生硬編號條列（如 1. 2. 3.），也不要複製貼上公文公告。\n"
        "5. 切中核心、不塞無關廣告：只針對顧客當前詢問的核心問題給予深入、專業的解答與對應的下一步引導，不複製貼上與問題無關的制式營業時間或電話。\n"
        "6. 極致精簡原則（最重要）：絕對嚴禁長篇大論！請嚴格控制在 1 到 2 句話以內（約 30~60 字），像真人店員在 LINE 快速回覆一樣，直接回答核心重點，俐落乾脆，絕不贅字囉嗦！\n\n"
        f"{photo_context_section}\n"
        "【門市核心知識庫】\n"
        f"- 現役價目參考：{prices_str}\n"
        "- 主要價目：襯衫/棉T 70元、長T 80元、帽T 90元、長褲 70元、牛仔褲 80元、西褲 100元、西裝外套 250元、西裝一套 350元、薄外套 150元、厚外套 180元、羽絨外套 280元、羽絨背心 200元、大衣 200~300元、真皮皮衣 1000元、滑雪雪服 250元、一般運動鞋 250元、皮運動鞋 300元、麂皮鞋 400元、皮鞋 400元、童鞋 150~200元、名牌鞋 600元、涼被 180元、單人被 350元、雙人被 500元、羽絨被 600元、羊毛/蠶絲被 800元、名牌包 1500~2000元、大布偶娃娃約 300元。\n"
        "- 門市位置：台中市西屯區青海路二段365號（至善國中正對面），門口路面寬敞好臨停。\n"
        "- 營業時間：週一至五 10:00-20:00；週六 12:00-18:00（週日固定公休，免預約送洗）。\n"
        "- 交期（日曆天）：一般衣物 5–7 天（薄被單、床單、枕頭套、被套也算一般衣物）；鞋 7 天；厚棉被、羽絨被、羊毛毯、地毯這類難乾的大件 10–14 天；皮件、包 14 天。皮衣、窗簾、娃娃等其他品項不報天數，回答「看件後店裡跟您說交期」。客人趕時間可請他跟櫃台說，店裡盡量調整，但不承諾提早。\n"
        "- 付款方式：現金、LINE Pay、轉帳；客人問其他付款方式時，回答目前店裡收現金、LINE Pay、轉帳。預估價先不用付。\n"
        "- 到府收送：台中市免費到府收送，沒有低消、一件也收；收送在營業時間內約，當天時段由店裡回覆。\n"
        "- 洗滌效果：一律以「師傅看件後說明可改善的範圍，不保證」回答，不對結果做任何承諾。\n"
        "- 查進度：直接在 LINE 對話框輸入「手機號碼」，系統即時列出送洗品項與進度。\n\n"
        "【專業洗護與客人高頻 FAQ 知識庫（展現專業水準）】\n"
        "1. 衣服特殊污漬（油漆/立可白/口香糖/指甲油/印泥/機油）：說明需特殊溶劑軟化再超音波乳化分解，切勿自行大力刮扯或倒去光水/酒精擦拭避免腐蝕布料，盡早乾燥送洗效果最佳。\n"
        "2. 衣服微修補（掉扣/開線/拉鍊/起毛球）：送洗若扣子在口袋可免費手工縫補；開線可基本車縫加固；毛衣針織有專業設備除毛球整理。\n"
        "3. 羽絨外套結塊/鑽毛：在家洗完結塊是因為羽毛受潮勾結，門市大滾筒低溫拍打烘透程序可把羽毛均勻拍散恢復蓬鬆；鑽毛採用羽絨專用柔洗防壓程。\n"
        "4. 真皮皮衣/PU皮/衝鋒衣：真皮做深層除霉與皮革滋養上油（1,000元）；PU皮脫皮為環保材質水解老化無法修復；始祖鳥/GORE-TEX衝鋒衣有專用防潑水修復洗程。\n"
        "5. 汗酸臭/老人味/加齡臭/毛小孩貓狗尿床/大娃娃：排汗衫酸臭為聚酯微孔皮脂氧化垢，門市採深層活氧除酸洗程；尿床採專用除氨酵素洗程；大娃娃用大槽水洗梳毛。氣味能改善多少要看件後說明，不保證完全去除。\n"
        "6. 為什麼要乾洗？不可水洗不可乾洗標籤？：乾洗用不含水有機溶劑，避免羊毛/真絲遇水氈化縮水變形與褪色；洗標寫不可水洗不可乾洗多為品牌避責，師傅會依纖維結構安排安全微乾洗或手工柔洗；環保現代乾洗機脫嗅完整無藥水味。\n"
        "7. 計費方式/保管/衣架包裝：門市一律單件透明計費，每件條碼追蹤；洗後附立體衣架與防塵塑膠套（棉被附防塵密封袋）；出差出國事先告知可享免費保管；非人為洗損有完善理賠保障制度。\n"
        "8. 領口腋下汗漬黃斑/血漬/彩妝：汗漬黃斑採溫水酵素預浸與局部去漬；血漬彩妝冷水乳化去除，切勿自行用熱水燙洗避免蛋白質凝固。\n"
        "9. 洗鞋為何需 7 天：鞋款大底多為環保膠，嚴禁高溫烘乾避免脫膠；採手工拆洗細刷，專用低溫除濕風乾室慢慢陰乾，工序繁複細緻以保護鞋體。\n"
        "10. 當顧客質疑是機器人或太官方：坦誠且專業地回應：「不好意思，剛剛的回覆可能比較制式。我是私享家門市專員，請問您主要想了解哪一種衣物或鞋包呢？我直接為您說明。」\n"
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{system_prompt}\n\n顧客剛剛傳送了這段話：\n「{user_text}」\n\n請以資深專業門市專員口吻，用純文字（不加粗體星號 **）極簡俐落（1~2句話，約30~60字）回覆顧客："}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 120,
        },
    }

    data_bytes = json.dumps(payload).encode("utf-8")

    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            req = Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req, timeout=3.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        text = parts[0].get("text", "").strip()
                        # Clean up any accidental markdown asterisks
                        text = text.replace("**", "").replace("##", "").strip()
                        return text
        except HTTPError as exc:
            print(f"[Chat] Model {model_name} HTTP {exc.code}, fallbacking...", file=sys.stderr)
            continue
        except Exception as exc:
            print(f"[Chat] Model {model_name} error: {exc}, fallbacking...", file=sys.stderr)
            continue

    return None


def generate_chat_reply(user_text: str, shop_root: Path, user_id: str = "") -> str:
    """Generate intelligent humanized reply with Gemini AI, fallback seamlessly to expanded corpus."""
    api_key = get_gemini_api_key(shop_root)

    # 1. Try Gemini Conversational AI first for ultra-contextual reply
    if api_key and len(user_text.strip()) > 1:
        try:
            ai_reply = call_gemini_chat(user_text, api_key, shop_root, user_id=user_id)
            if ai_reply and len(ai_reply) > 8:
                return ai_reply
        except Exception as e:
            print(f"[Chat] Gemini chat call failed: {e}", file=sys.stderr)

    # 2. Check if user is replying to recent photo session for fallback
    session = get_photo_session(shop_root, user_id) if user_id else None
    if session:
        cat = session.get("category", "衣物")
        price = session.get("price", "")
        # If user talks about stains, time, or confirmation
        lower_t = user_text.lower()
        if any(w in lower_t for w in ("洗得掉", "救得", "能救", "去得掉", "乾淨", "痕跡")):
            return f"只要沒用熱水或漂白劑搓過，通常有機會淡化，能改善多少要師傅看件後說明，不保證。歡迎直接帶到門市（至善國中對面好停車），讓師傅現場評估最精準。"
        if any(w in lower_t for w in ("幾天", "多久", "時間", "何時", "急")):
            return f"這件{cat}的交期：一般衣物 5–7 天、鞋 7 天、厚棉被這類難乾的大件 10–14 天、皮件和包 14 天，其他品項看件後店裡跟您說交期。若有急用，送來時跟師傅說一聲，我們盡量幫您調整喔！"
        if any(w in lower_t for w in ("好", "可以", "謝謝", "明天", "等下", "過去", "拿去", "送去", "去洗")):
            return "好的！送洗免預約，營業時間直接帶過來門市（至善國中對面好停車）就可以囉，期待為您服務！"

    # 3. Fallback to 550+ phrase corpus with intent matching & anti-repetition memory
    return dialog_corpus.get_human_reply(user_text)
