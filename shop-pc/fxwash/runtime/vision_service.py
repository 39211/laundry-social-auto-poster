"""AI Vision & Smart Photo Quote Service for LINE Official Account.

Supports Google Gemini Vision API with an 8-Tier Deep Analysis Architecture
for garments, shoes, luxury goods, leather, and bedding, based on store Dco prices.json,
Clothing_Memory.md, and Memory.md. Includes optical flaw/stain pre-diagnosis,
anti-fooling structural checks, photo context session persistence, and warm,
humanized multi-turn conversational guidance.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from runtime.photo_session import save_photo_session

GEMINI_MODELS = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite",
]


def get_vision_api_key(shop_root: Path) -> str:
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


def download_line_image(message_id: str, line_token: str) -> bytes | None:
    """Download image binary from LINE Data API."""
    url = f"https://api-data.line.me/v2/bot/message/{message_id}/content"
    req = Request(
        url,
        headers={"Authorization": f"Bearer {line_token}"},
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            return resp.read()
    except Exception as exc:
        print(f"[Vision] Failed to download image {message_id} from LINE: {exc}", file=sys.stderr)
        return None


def get_shoe_memory(shop_root: Path) -> str:
    """Retrieve shoe recognition memory and guidelines from config/Memory.md."""
    mem_file = shop_root / "config" / "Memory.md"
    if mem_file.exists():
        try:
            return mem_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""


def get_clothing_memory(shop_root: Path) -> str:
    """Retrieve clothing recognition memory and guidelines from config/Clothing_Memory.md."""
    mem_file = shop_root / "config" / "Clothing_Memory.md"
    if mem_file.exists():
        try:
            return mem_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""


def append_garment_memory(shop_root: Path, raw_text: str, user_id: str = "") -> str:
    """Parse hidden GARMENT_INFO tag, persist photo session, log to Memory, and return clean text."""
    match = re.search(r"<!--\s*(?:GARMENT_INFO|SHOE_INFO):\s*(.*?)\s*-->", raw_text, re.DOTALL)
    if not match:
        return raw_text

    raw_payload = match.group(1).strip()
    fields: dict[str, Any] = {}
    if raw_payload.startswith("{") and raw_payload.endswith("}"):
        try:
            fields = json.loads(raw_payload)
        except Exception:
            fields = {}

    if not fields:
        for part in raw_payload.split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                fields[k.strip().lower()] = v.strip()

    item_type = str(fields.get("type") or "").lower()
    brand = str(fields.get("brand") or "未註明").strip()
    model = str(fields.get("model") or "常規款式").strip()
    material = str(fields.get("material") or "常規材質").strip()
    color = str(fields.get("color") or "常見色").strip()
    category = str(fields.get("category") or fields.get("type") or "衣服").strip()
    price = str(fields.get("price") or "現場評估").strip()
    notes = str(fields.get("notes") or "標準洗滌保養").strip()
    stain_detected = str(fields.get("stain_detected") or fields.get("stain") or "").strip()
    question_asked = str(fields.get("question_asked") or fields.get("question") or "").strip()

    luxury_keywords = (
        "gucci", "chanel", "lv", "louis vuitton", "hermes", "愛馬仕", "dior", "迪奧",
        "prada", "balenciaga", "巴黎世家", "ysl", "saint laurent", "fendi", "celine",
        "burberry", "loewe", "moncler", "golden goose", "christian louboutin",
        "ferragamo", "bottega veneta", "bv", "alexander mcqueen", "valentino",
        "versace", "givenchy", "tod's", "tods", "mcm", "thom browne", "canada goose",
        "loro piana", "miu miu", "brunello cucinelli", "arc'teryx", "始祖鳥",
        "stone island", "supreme", "chrome hearts"
    )
    is_lux = str(fields.get("is_luxury", "false")).lower() in ("true", "yes", "1") or any(
        kw in brand.lower() for kw in luxury_keywords
    )

    # Persist session context for multi-turn conversational follow-up
    if user_id:
        session_data = {
            "type": item_type,
            "brand": brand,
            "model": model,
            "material": material,
            "color": color,
            "category": category,
            "price": price,
            "notes": notes,
            "stain_detected": stain_detected,
            "question_asked": question_asked,
            "is_luxury": is_lux,
        }
        save_photo_session(shop_root, user_id, session_data)
        print(f"[PhotoSession] Cached diagnosis for user {user_id[:8]}...: {brand} {category} ({price}元)")

    lux_badge = " (👑 國際精品奢牌/高階品牌)" if is_lux else ""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    entry = (
        f"\n- **[{ts}]**{lux_badge}\n"
        f"  - **品牌/款式**：{brand} {model}\n"
        f"  - **材質**：{material}\n"
        f"  - **顏色**：{color}\n"
        f"  - **判定分類**：{category}\n"
        f"  - **估價金額**：{price} 元\n"
        f"  - **洗滌工法**：{notes}\n"
    )
    if stain_detected:
        entry += f"  - **觀察污況**：{stain_detected}\n"
    if question_asked:
        entry += f"  - **引導提問**：{question_asked}\n"

    shoe_keywords = ("鞋", "靴", "涼鞋", "拖鞋", "運動鞋", "皮鞋", "童鞋", "高跟鞋")
    is_shoe = item_type == "shoe" or any(sk in category for sk in shoe_keywords)

    target_file = shop_root / "config" / ("Memory.md" if is_shoe else "Clothing_Memory.md")
    if target_file.exists():
        try:
            content = target_file.read_text(encoding="utf-8")
            if "## 📝" in content:
                content += entry
                target_file.write_text(content, encoding="utf-8")
                try:
                    print(f"[Vision Memory] Recorded {brand} {model} ({price}元) [Luxury: {is_lux}] into {target_file.name}")
                except Exception:
                    pass
        except Exception as e:
            try:
                print(f"[Vision Memory] Failed to write {target_file.name}: {e}", file=sys.stderr)
            except Exception:
                pass

    clean_text = re.sub(r"<!--\s*(?:GARMENT_INFO|SHOE_INFO):\s*.*?\s*-->", "", raw_text, flags=re.DOTALL).strip()
    return clean_text


# Backward compatibility alias
append_shoe_memory = append_garment_memory


def get_prices_summary(shop_root: Path) -> str:
    """Read prices.json and format into a structured summary string."""
    prices_file = shop_root / "config" / "prices.json"
    if not prices_file.exists():
        return (
            "- 一般運動鞋：250元/雙\n"
            "- 休閒鞋：250元/雙\n"
            "- 童鞋：150~200元/雙\n"
            "- 皮運動鞋：300元/雙\n"
            "- 混和運動鞋：350元/雙\n"
            "- 皮鞋/高跟鞋：400元/雙\n"
            "- 麂皮鞋/反毛皮鞋：400元/雙\n"
            "- 一般登山鞋/低靴子：350元/雙\n"
            "- 中靴子：450元/雙\n"
            "- 高靴子/高筒登山鞋：500~550元/雙\n"
            "- 名牌鞋：600元/雙\n"
            "- 拖鞋：200元/雙\n"
            "- 涼鞋：250元/雙\n"
            "- 襯衫/棉T：70元/件\n"
            "- 長T：80元/件\n"
            "- 帽T：90元/件\n"
            "- 西褲：100元/件\n"
            "- 西裝：250元/件\n"
            "- 西裝一套：350元/套\n"
            "- 薄外套：150元/件\n"
            "- 厚外套：180元/件\n"
            "- 羽絨外套：280元/件\n"
            "- 羽絨背心：200元/件\n"
            "- G-T外套：250元/件 (2件式450元)\n"
            "- 短大衣：200元/件\n"
            "- 中大衣：250元/件\n"
            "- 長大衣：300元/件\n"
            "- 皮衣：1000元/件 (特殊皮衣2000元)\n"
            "- 短皮夾：400元/個\n"
            "- 長皮夾/書包背包：600元/個\n"
            "- 皮包包：1000元/個\n"
            "- 名牌包：1500~2000元/個\n"
            "- 涼被：180元/件\n"
            "- 棉被小/大：350/500元/件\n"
            "- 羽絨被：600元/件\n"
            "- 蠶絲羊毛被：800元/件\n"
            "- 精品棉T/襯衫：100元/件\n"
            "- 精品長T：110元/件\n"
            "- 精品帽T：120元/件\n"
            "- 精品外套：200~230元/件\n"
            "- 精品大衣：250~350元/件\n"
            "- 精品羽絨：280~350元/件"
        )
    try:
        data = json.loads(prices_file.read_text(encoding="utf-8"))
        categories = data.get("categories", {})
        if categories:
            sections = []
            for cat, its in categories.items():
                cat_lines = [f"【{cat}】"]
                for it in its:
                    p = f"{it['price']} 元" if it.get("price") is not None else "現場評估"
                    cat_lines.append(f"- {it['name']}：{p} / {it.get('unit', '件')}")
                sections.append("\n".join(cat_lines))
            return "\n\n".join(sections)

        items = data.get("items", [])
        lines = []
        for it in items:
            p = f"{it['price']} 元" if it.get("price") is not None else "現場評估"
            lines.append(f"- {it['name']}：{p} / {it.get('unit', '件')}")
        return "\n".join(lines)
    except Exception:
        return ""


def call_gemini_vision(
    image_bytes: bytes,
    api_key: str,
    prices_summary: str,
    shoe_memory: str = "",
    clothing_memory: str = "",
) -> str | None:
    """Call Google Gemini Vision with 8-Tier Deep Analysis Architecture."""
    b64_img = base64.b64encode(image_bytes).decode("utf-8")

    prompt = (
        "你是台灣台中市在地知名優質洗衣門市「私享家專業洗衣」的資深洗衣師傅與首席門市顧問。\n"
        "你具備超過20年專業洗衣、精細乾水洗、名牌包鞋養護與高級皮草護理經驗。\n"
        "請以沉穩、洗鍊、得體、親切且專業的繁體中文口吻檢視照片，並嚴格遵循【8層全方位專家級深度分析思考鏈】進行判斷：\n\n"
        f"【門市官方現役價目表（對齊 eHank Dco 系統）】\n{prices_summary}\n\n"
    )

    if shoe_memory:
        prompt += (
            f"【鞋款歷史對照記憶庫 (Memory.md)】\n"
            "若照片是鞋類或皮革配件，請優先對照此專屬知識庫：\n"
            f"{shoe_memory}\n\n"
        )

    if clothing_memory:
        prompt += (
            f"【衣物辨識與定價核心知識庫 (Clothing_Memory.md)】\n"
            "若照片是衣物或服飾配件，請務必嚴格遵循此專屬知識庫的結構判斷準則與門市定價：\n"
            f"{clothing_memory}\n\n"
        )

    prompt += (
        "【👑 8層全方位專家級深度分析思考鏈（請深入審視每個環節再生成回覆）】：\n"
        "────────────────────────────────────────────────\n"
        "第 1 層【幾何與解剖學結構絕對防呆（物理尺寸與人體結構對應）】：\n"
        "  1. 袖長幾何絕對防呆（棉T vs 長T）：\n"
        "     - 袖口下擺僅停留在上手臂、二頭肌或腋下胸線位置（袖長顯著小於衣服自身長度的 1/3）➔ 100% 絕對判定為【短袖棉T】（70元）！\n"
        "     - 只有當袖管向下延伸接近、齊平或超過衣服底邊下擺（袖長達到衣身長度 2/3 以上）➔ 才是【長T】（80元）或薄長袖！\n"
        "     - 絕對防呆禁令：絕不可將任何短袖圓領T恤、短袖印花上衣誤判為長T！胸前的直條印花或視覺延伸絕不可影響袖長幾何判斷！\n"
        "  2. 獨立褲管雙腿結構絕對防呆（西褲/長褲 vs 外套/大衣）：\n"
        "     - 只要有左、右兩條獨立褲腿結構，有腰頭腰圍、拉鍊門襟與交叉襠部車線，即便掛在衣架上垂直垂下，100% 判定為褲類（西褲100元 / 長褲70元 / 牛仔褲80元 / 短褲60元），絕對不可誤判為西裝外套或大衣！\n"
        "  3. 西裝一套 vs 西裝外套 vs 西褲：\n"
        "     - 只有單獨一條西裝長褲 ➔ 判定為【西褲】（100元），絕不能報西裝外套250元！\n"
        "     - 單獨一件西裝上衣（平駁領/戧駁領、前排開襟扣、墊肩）➔ 判定為【西裝】（250元）。\n"
        "     - 照片中西裝外套與同套西褲兩件同框合拍 ➔ 判定為【西裝一套】（350元）。\n"
        "  4. 半身裙 vs 連身洋裝：\n"
        "     - 僅下半身自腰部展開 ➔ 短裙/中裙/長裙（80/100/120元）；上半身與下身一體連身 ➔ 短洋裝/中洋裝/長洋裝（120/150/180元）。\n"
        "  5. 帽T vs 開襟外套 vs 棉T：\n"
        "     - 連帽套頭+袋鼠口袋 ➔ 帽T（90元）；前開全拉鍊或整排開扣 ➔ 外套（150~180元）；無帽無前開薄棉 ➔ 棉T（70元）。\n"
        "  6. 羽絨外觀判定：明顯蓬鬆羽絨填充+格狀絎縫壓線車線 ➔ 100% 判定為【羽絨外套】（280元，精品280~350元），絕非普通厚外套。\n"
        "  7. 配件類：棒球帽/老帽/鴨舌帽/毛帽歸類為【帽子】（100元，精品130元），非衣服或鞋子；圍巾110元；領帶100元；皮帶400元。\n\n"
        "第 2 層【國際精品奢牌與高階潮牌極致辨識】：\n"
        "  - 仔細比對品牌標誌、經典紋樣、五金刻字與特殊廓形：\n"
        "    * 國際奢牌：Chanel (雙C/菱格/軟呢), LV (Monogram老花/棋盤格), Gucci (雙G/紅綠織帶), Dior (Oblique老花/馬鞍), Hermès (愛馬仕H扣/絲巾), Prada (三角鐵牌/再生尼龍), Balenciaga (巴黎世家老爹鞋/可樂標), BV (編織皮革), Burberry (戰馬格紋), Moncler (公雞標羽絨), Canada Goose (北極圓標), Loewe (Puzzle), Celine (凱旋門), Thom Browne (四條槓), Loro Piana (白底鞋/羊絨), Brunello Cucinelli, Golden Goose (小髒鞋五角星)。\n"
        "    * 高階機能與潮流品牌：始祖鳥 Arc'teryx (骨骼化石標/Gore-Tex衝鋒衣), The North Face (北面刺繡), Stone Island (羅盤袖標), Supreme, Off-White, Chrome Hearts。\n"
        "  - 嚴格對照門市【精品 / 名牌】官方標準計費：\n"
        "    * 精品鞋 ➔ 歸類為【名牌鞋】（600 元；做舊老爹鞋 600~800 元）\n"
        "    * 精品包 ➔ 歸類為【名牌包】（1,500 元）或【特殊名牌包】（2,000 元）；短皮夾 400 元 / 長皮夾 600 元\n"
        "    * 精品衣物 ➔ 門市【精品衣物】標準（精品棉T/襯衫 100元、精品外套 200~230元、精品大衣 250~350元、精品洋裝 150~210元、精品羽絨 280~350元、精品真皮皮衣 2,000元）\n\n"
        "第 3 層【主料、輔料與複合拼接材質深度辨識】：\n"
        "  - 麂皮/反毛皮/磨砂革 (Suede/Nubuck)：嚴禁泡水，遇水極易硬化掉色，採專用生膠擦與滋潤保養乳手工護理，對照門市「麂皮鞋」標準 (400元；童鞋麂皮款200~400元)。\n"
        "  - 羊毛/羊絨/馬海毛 (Wool/Cashmere)：防縮水氈化，安排低溫四氯乙烯/碳氫微乾洗或羊毛專用柔洗，並做立體整燙復形。\n"
        "  - 機能防水透氣薄膜 (Gore-Tex, DryVent)：嚴禁一般柔軟精破壞微孔，採用機能衣專用洗劑與防潑水活化洗程（G-T外套 250元，兩件式 450元）。\n"
        "  - 真皮皮革 (Cow/Lamb/Pig skin)：深層除霉與皮革滋潤乳上油保養（皮衣 1,000元，皮短褲/皮裙 600元，皮長褲 700元，皮包 1,000元）。\n"
        "  - 複合拼接材質：棉身真皮袖（棒球外套）、羽絨拼接針織袖等，依各部位複合工藝說明。\n\n"
        "第 4 層【污漬、瑕疵與老化光學診斷（主動發現問題與前置預警）】：\n"
        "  - 檢查照片中的表面污漬：領口/袖口黃斑皮脂垢、胸前食物油漬醬汁、咖啡水痕、汗酸泛黃、發霉黑斑點等。\n"
        "  - 檢查材質老化與洗損風險：\n"
        "    * 環保 PU 人造皮革起泡、掉屑、脫皮水解：主動溫柔提示此為 PU 聚氨酯自然物理老化水解，不可逆，洗滌時會全力保護基底。\n"
        "    * 老舊運動鞋生膠底氧化發黃、中底開膠：提示可低溫洗淨並提供脫膠加固建議。\n"
        "    * 膠印圖案脆化裂紋：提示反面低溫洗滌保護。\n\n"
        "第 5 層【可拆卸配件與附加物清點】：\n"
        "  - 檢查是否有真毛領（狐狸毛、貉子毛）：提示需拆卸獨立洗護。\n"
        "  - 檢查是否為可拆內膽之兩件式衝鋒衣：歸類為 G-T外套2件式（450元）。\n"
        "  - 金屬拉鍊牌、腰帶扣件：洗滌時包裹保護防刮花面料。\n\n"
        "第 6 層【特殊件、大件寢具與絨毛玩偶深度歸類】：\n"
        "  - 涼被（單層薄被，180元）vs 單人被（350元）vs 雙人被（500元）vs 羽絨被（600元）vs 羊毛/蠶絲被（800元）。\n"
        "  - 絨毛玩偶娃娃：按尺寸判斷（小型60~100元、中型150~200元、大型約300元）。\n\n"
        "第 7 層【門市 Dco 價目核對與計費精算】：\n"
        "  - 精確對照 prices.json、Clothing_Memory.md 與 Memory.md，給出明確、透明、篤定的費用。\n\n"
        "第 8 層【真人口吻極簡引導式對話生成（篇幅務必精簡俐落）】：\n"
        "  - 嚴格指令：絕對嚴禁長篇大論！顧客在手機上看 LINE 訊息，太長會有閱讀壓力！\n"
        "  - 請將回覆嚴格壓縮在 2~3 句話（總字數約 60~100 字）：\n"
        "    1. 第一句（品項+門市分類+金額）：您好，這件/雙是 [品牌] [款式]（[主要材質]），在門市分類為【[品項分類]】，洗滌費用為 [金額] 元。\n"
        "    2. 第二句（重點工藝與引導提問）：[針對污漬或材質的1句精華說明，並帶出1個簡短提問，例如：領口皮脂我們會安排酵素預浸，請問這污漬大概多久了呢？ / 麂皮會以專用保養乳手工刷洗防硬化，鞋頭有需要順便補膠嗎？ / 內側若有洗標也歡迎拍過來雙重確認喔！]\n"
        "    3. 第三句（到店指引一句話）：送洗免預約，營業時間直接帶到門市（至善國中正對面好停車）就可以囉！\n\n"
        "【嚴格排版格式規範】：\n"
        "1. 請輸出純文字短句，嚴禁包含任何星號 ** 粗體標籤或 markdown 語法！\n"
        "2. 嚴格禁令：絕對嚴禁附加「💡 貼心小提醒」、「・營業時間...・查進度...」等死板條列清單！\n"
        "3. 在回覆最末尾單獨換行附上結構化標籤（供系統自動寫入專屬記憶庫與對話 session，系統會自動過濾不會顯示給顧客）：\n"
        "<!-- GARMENT_INFO: type=shoe/clothing/accessory/bag/bedding; brand=品牌; model=款式型號; material=材質; color=顏色; category=品項分類; price=金額; notes=洗滌要點; is_luxury=true/false; stain_detected=觀察到的污漬或瑕疵; question_asked=向顧客提出的引導問題 -->\n"
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": b64_img,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
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
            with urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "").strip()
        except HTTPError as exc:
            if exc.code == 429:
                print(f"[Vision] Model {model_name} rate limit (429), waiting 1s...", file=sys.stderr)
                time.sleep(1)
            else:
                print(f"[Vision] Model {model_name} failed with HTTP {exc.code}, trying next model...", file=sys.stderr)
            continue
        except Exception as exc:
            print(f"[Vision] Model {model_name} failed with {exc}, trying next model...", file=sys.stderr)
            continue

    return None


def build_photo_quote_reply(image_bytes: bytes | None, shop_root: Path, user_id: str = "") -> list[dict]:
    """Generate intelligent photo estimate reply with 8-tier vision analysis and session persistence."""
    api_key = get_vision_api_key(shop_root)
    prices_summary = get_prices_summary(shop_root)
    shoe_memory = get_shoe_memory(shop_root)
    clothing_memory = get_clothing_memory(shop_root)

    # Path A: Gemini Vision API is available and image was downloaded
    if api_key and image_bytes:
        print(f"[Vision] Analyzing image for user {user_id[:8]}... using 8-Tier Architecture...")
        raw_reply = call_gemini_vision(
            image_bytes,
            api_key,
            prices_summary,
            shoe_memory=shoe_memory,
            clothing_memory=clothing_memory,
        )
        if raw_reply:
            # Process memory recording, cache session context, and get clean text
            clean_reply = append_garment_memory(shop_root, raw_reply, user_id=user_id)
            # Remove any stray markdown asterisks just in case
            clean_reply = clean_reply.replace("**", "").replace("##", "").strip()
            return [{"type": "text", "text": clean_reply}]

    # Natural fallback when vision API not configured or offline
    text = (
        "您好，已收到您的照片！門市人員稍後為您確認初估費用。\n"
        "若方便也可翻拍洗標，送洗免預約，直接帶到門市（至善國中對面好停車）就可以囉！"
    )
    return [{"type": "text", "text": text}]
