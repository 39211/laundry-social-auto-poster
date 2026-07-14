import { buildGitHubPagesImageUrl } from "./githubPages";
import { buildGrowthPlaybook, type GrowthFormat, type GrowthPlaybookSlot } from "./growthPlaybook";
import { relativeAssetPath } from "./paths";
import { DAILY_SCHEDULE } from "./scheduler";
import type { AppConfig, Category, DailyContent, DailySlot, TrafficRoute, VisualRoute } from "./types";

interface SlotTemplate {
  topic: string;
  opener: string;
  context: string;
  inspection: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  visualRoute: VisualRoute;
  trafficRoute: TrafficRoute;
}

const brandLine = "私享家洗衣店";

const knowledgePlans: SlotTemplate[] = [
  {
    topic: "白鞋鞋舌與鞋墊的雨後濕氣",
    opener: "白鞋下雨後看起來只是鞋面有點灰，真正容易留下味道的地方常常是鞋舌和鞋墊下面。",
    context:
      "鞋舌縫線、鞋墊底層和內裡布料吸到濕氣後，如果只是放著陰乾，味道可能會被悶在裡面，鞋邊也更容易泛黃。",
    inspection:
      "我們會先確認鞋墊能不能拆、內裡是否有汗味或雨水味，再看鞋舌縫線、鞋面材質和膠邊狀態，判斷要做表面清潔、內裡處理，還是分段整理。",
    cta: "鞋子淋過雨又開始有味道，可以先拍鞋面、鞋舌和鞋內給我們看。",
    hashtags: ["#私享家洗衣店", "#白鞋清潔", "#雨季保養", "#鞋子保養"],
    imagePrompt:
      "Realistic square shop photo inside a premium Taiwanese laundry and shoe-care counter: white sneakers on an inspection table with one shoe tongue gently lifted, removable insole beside it, staff hands checking inner lining moisture, soft daylight, practical documentary style, no logo, no readable text, no poster design, no watermark.",
    visualRoute: "shop-inspection",
    trafficRoute: "object-proof"
  },
  {
    topic: "外套領口袖口的汗味與暗沉",
    opener: "外套穿幾次後，最先讓人覺得不乾淨的通常不是整件衣服，而是領口、袖口和拉鍊邊。",
    context:
      "這些位置會接觸脖子、手腕、香水和汗，時間一久會慢慢暗下來，有時候外觀看起來還好，靠近聞才知道味道已經卡住。",
    inspection:
      "我們會先看外套材質、內裡厚度、領口磨擦痕和袖口油汗痕，判斷適合整件整理、局部加強，或只做收納前清潔。",
    cta: "如果外套準備收起來，先拍領口、袖口和洗標，我們幫你判斷怎麼處理比較穩。",
    hashtags: ["#私享家洗衣店", "#外套清潔", "#衣物保養", "#收納前整理"],
    imagePrompt:
      "Realistic square shop photo at a laundry counter: a jacket laid flat with collar and cuff areas visible, care label partly shown but unreadable, staff hand checking fabric darkening with a neutral glove, clean inspection mat, premium practical shop lighting, no logo, no readable text, no poster.",
    visualRoute: "macro-detail",
    trafficRoute: "dwell-detail"
  },
  {
    topic: "棉被收納前的濕氣與睡眠味",
    opener: "棉被要收進櫃子前，不能只看表面乾不乾，還要看有沒有睡眠味和悶住的濕氣。",
    context:
      "台中潮濕的日子多，棉被如果帶著身體味和濕氣直接收納，下一季拿出來容易有悶味，布面也比較不清爽。",
    inspection:
      "我們會看棉被厚度、表布材質、縫線位置和填充狀態，再判斷能不能水洗、需不需要分區處理，以及收納前要不要加強乾燥。",
    cta: "要整理棉被前，可以先拍整件、洗標和有味道的位置給我們看。",
    hashtags: ["#私享家洗衣店", "#棉被清潔", "#布品收納", "#台中洗衣店"],
    imagePrompt:
      "Realistic square shop photo inside a laundry shop: folded bedding and quilt on a clean counter, staff checking seam and fabric tag, storage bag nearby, bright natural light, premium tidy documentary style, no readable text, no fake brand, no watermark.",
    visualRoute: "shop-inspection",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "包包提把的手汗與邊油痕",
    opener: "包包提把如果開始變黏、變暗，通常不是單純灰塵，而是手汗、保養品和摩擦慢慢堆在表面。",
    context:
      "提把和包角是最常被碰到的位置，處理方式如果太強，可能讓皮革變乾、帆布起毛，或讓原本的邊油痕更明顯。",
    inspection:
      "我們會先分辨提把是皮革、合成皮還是布面，再看邊油、縫線和轉角磨耗，判斷能清到什麼程度、哪些痕跡需要保守處理。",
    cta: "包包提把變暗時，可以拍近照和整包照片，我們先幫你看材質狀態。",
    hashtags: ["#私享家洗衣店", "#包包清潔", "#提把清潔", "#精品洗護"],
    imagePrompt:
      "Realistic square shop photo at a bag-care counter: everyday handbag with handle close-up visible, staff hand inspecting darkened handle and edge coating, clean neutral surface, premium laundry boutique atmosphere, no logo, no readable text, no poster.",
    visualRoute: "macro-detail",
    trafficRoute: "object-proof"
  },
  {
    topic: "皮鞋雨痕與鞋面乾裂前的檢查",
    opener: "皮鞋淋雨後如果只擦乾表面，水痕和鞋面乾裂的問題有時候會過幾天才浮出來。",
    context:
      "皮革遇到雨水、泥灰和冷氣房乾燥，表面油分狀態會改變，太急著用不適合的保養品，反而可能讓顏色不均。",
    inspection:
      "我們會先看鞋面皮革種類、摺痕深度、鞋邊縫線和水痕範圍，再判斷是清潔、補油保養，還是先做溫和整理。",
    cta: "皮鞋淋雨後先不要亂上油，拍鞋面、水痕和鞋底邊給我們判斷。",
    hashtags: ["#私享家洗衣店", "#皮鞋保養", "#鞋子清潔", "#雨季保養"],
    imagePrompt:
      "Realistic square shop photo in a shoe-care workspace: leather dress shoes on a clean inspection table, subtle rain marks on upper, soft cloth and brush nearby, staff hand checking creases, premium documentary style, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "trust-reset"
  },
  {
    topic: "帆布鞋泥點滲進布紋後的處理",
    opener: "帆布鞋沾到泥點時，最麻煩的不是表面那一點灰，而是泥水滲進布紋後留下的影子。",
    context:
      "如果直接用硬刷刷到變白，布面可能起毛、顏色變淡，鞋邊和縫線也容易被刷出粗糙感。",
    inspection:
      "我們會看帆布顏色、泥點深度、鞋邊膠痕和縫線髒污，再判斷要做局部處理、整雙清潔，還是保留材質原本的紋理感。",
    cta: "帆布鞋沾泥後，可以先拍鞋面近照和鞋邊，我們幫你看能不能整理。",
    hashtags: ["#私享家洗衣店", "#帆布鞋清潔", "#鞋子保養", "#台中洗鞋"],
    imagePrompt:
      "Realistic square shop photo: canvas sneakers with small mud marks on a clean counter, fabric texture visible, staff hand pointing to woven surface and rubber edge, natural light, practical premium laundry shop look, no poster, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "object-proof"
  },
  {
    topic: "羽絨外套壓扁後的蓬度判斷",
    opener: "羽絨外套收久了變扁，不一定代表壞掉，但清潔和乾燥方式會影響它能不能回到比較舒服的蓬度。",
    context:
      "羽絨最怕洗完沒有乾透，裡面結塊或有悶味，下一次穿起來就會覺得重量不均、保暖感變差。",
    inspection:
      "我們會先看填充分布、表布防潑水狀態、領口袖口髒污和洗標限制，再判斷清潔與乾燥方式。",
    cta: "羽絨外套要洗前，先拍整件、壓扁的位置和洗標，我們幫你判斷風險。",
    hashtags: ["#私享家洗衣店", "#羽絨外套清潔", "#冬衣收納", "#衣物保養"],
    imagePrompt:
      "Realistic square shop photo inside a laundry counter: puffer jacket laid on a clean table, staff hand checking flattened quilting sections and cuff, storage hanger nearby, bright premium practical lighting, no logo, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "抱枕布套飲料痕與局部色差",
    opener: "抱枕布套如果有飲料痕，最怕的是當下擦一擦看起來淡了，乾掉後才留下局部色差。",
    context:
      "沙發布、抱枕布和填充物吸水速度不同，髒污如果擴散到縫線或內層，處理方式就不能只看表面。",
    inspection:
      "我們會先看布套能不能拆、材質是否會褪色、飲料痕停留多久，再判斷適合局部處理或整件清潔。",
    cta: "抱枕有痕跡時，先拍污漬、縫線和洗標，我們再幫你判斷。",
    hashtags: ["#私享家洗衣店", "#布品清潔", "#抱枕清潔", "#居家保養"],
    imagePrompt:
      "Realistic square shop photo at a laundry inspection counter: cushion cover with a faint drink stain, seam detail visible, staff hand holding fabric edge, soft daylight, clean premium documentary style, no logo, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "dwell-detail"
  },
  {
    topic: "襯衫腋下汗漬與布料發黃",
    opener: "襯衫腋下如果開始有黃痕，通常不是洗一次就能完全看結果，要先判斷汗漬停留多久和布料狀態。",
    context:
      "汗、止汗產品和洗滌殘留混在一起，會讓腋下布料變硬或變黃，太強的處理也可能傷到纖維。",
    inspection:
      "我們會先看襯衫材質、腋下色差、布料脆化程度和領口袖口狀態，再決定適合局部加強或整件處理。",
    cta: "襯衫發黃時，可以拍腋下、領口和洗標，我們先幫你看可處理程度。",
    hashtags: ["#私享家洗衣店", "#襯衫清潔", "#汗漬處理", "#衣物保養"],
    imagePrompt:
      "Realistic square shop photo: white shirt on a laundry inspection table, underarm area and collar visible without graphic emphasis, staff hand checking fabric condition, clean neutral lighting, premium practical shop style, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "trust-reset"
  },
  {
    topic: "安全帽內襯與外套帽沿的汗味",
    opener: "通勤族常忽略安全帽內襯和外套帽沿，這兩個位置其實很容易累積汗味、髮品和濕氣。",
    context:
      "如果下雨後又直接戴上或收起來，味道會更明顯，也可能沾到外套帽沿和領口。",
    inspection:
      "我們會看可拆洗結構、布料厚度、汗味來源和外套帽沿材質，再判斷能不能清潔或需要保守除味。",
    cta: "如果帽沿或內襯開始有味道，可以拍材質和可拆位置給我們看。",
    hashtags: ["#私享家洗衣店", "#通勤保養", "#衣物除味", "#雨季保養"],
    imagePrompt:
      "Realistic square shop photo: jacket hood edge and removable helmet liner on a clean laundry counter, staff hand checking fabric lining, tidy Taiwanese shop setting, natural light, no logo, no readable text, no poster.",
    visualRoute: "customer-consultation",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "行李箱布面與輪邊灰塵",
    opener: "行李箱回來後，布面、把手和輪邊常常比衣服更早累積灰塵和地面髒污。",
    context:
      "如果直接推進房間或靠近衣櫃，輪邊泥灰和把手汗味會跟著進到家裡，布面也容易越看越暗。",
    inspection:
      "我們會先看行李箱材質、布面髒污深度、輪邊泥灰和把手接觸痕，再判斷適合局部清潔或外觀整理。",
    cta: "旅行回來要整理行李箱，可以先拍布面、把手和輪邊給我們看。",
    hashtags: ["#私享家洗衣店", "#行李箱清潔", "#旅行後整理", "#台中洗衣店"],
    imagePrompt:
      "Realistic square shop photo: fabric suitcase on a clean inspection floor mat near a laundry counter, wheel edge and handle visible, staff hand pointing to dust buildup, premium documentary look, no readable text, no logo.",
    visualRoute: "shop-inspection",
    trafficRoute: "share-worthy-care"
  },
  {
    topic: "寵物毯毛屑與味道分開處理",
    opener: "寵物毯要整理時，毛屑和味道要分開看，因為看起來乾淨不代表味道已經處理掉。",
    context:
      "毛屑容易卡在布紋和邊角，味道則常留在厚布或填充層裡，直接跟一般衣物混洗不一定適合。",
    inspection:
      "我們會先看毯子厚度、毛屑量、異味位置和布料耐受度，再判斷清潔流程和是否需要先做分離處理。",
    cta: "寵物毯要送洗前，先拍整件、毛屑位置和洗標，我們幫你看怎麼整理。",
    hashtags: ["#私享家洗衣店", "#寵物毯清潔", "#布品清潔", "#居家保養"],
    imagePrompt:
      "Realistic square shop photo: pet blanket folded on a laundry inspection table with lint roller and soft brush nearby, staff hand checking fabric edge, clean premium shop lighting, no animals, no logo, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "object-proof"
  },
  {
    topic: "西裝外套肩線與內裡狀態",
    opener: "西裝外套不能只看外面有沒有髒，肩線、內裡和袖口狀態會決定它適合怎麼整理。",
    context:
      "正式外套如果處理太急，版型、肩線和內裡都可能受影響，所以送洗前需要先看結構，不是只看污漬大小。",
    inspection:
      "我們會先確認布料、襯裡、肩線支撐、袖口汗漬和局部痕跡，再判斷適合整件清潔或局部處理。",
    cta: "西裝外套要整理前，拍正面、肩線、袖口和洗標給我們看會比較準。",
    hashtags: ["#私享家洗衣店", "#西裝清潔", "#衣物保養", "#精品洗護"],
    imagePrompt:
      "Realistic square shop photo: suit jacket on a padded hanger at a laundry inspection station, shoulder line and inner lining visible, staff hand checking cuff, premium quiet shop lighting, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "trust-reset"
  },
  {
    topic: "鞋櫃悶味來源不是只有鞋面",
    opener: "鞋櫃一打開有悶味時，不一定是鞋面髒，很多時候是鞋墊、內裡和鞋底邊緣一起累積出來的味道。",
    context:
      "雨季、汗水和不通風的鞋櫃會讓味道慢慢變重，單純噴香味只能蓋過一陣子，來源還是留在裡面。",
    inspection:
      "我們會先看鞋款材質、鞋墊能不能拆、內裡濕氣和鞋底邊緣狀態，再判斷適合除味、清潔或分次處理。",
    cta: "鞋櫃開始有味道時，先挑最常穿的那雙拍鞋內和鞋底給我們看。",
    hashtags: ["#私享家洗衣店", "#鞋子除味", "#鞋子清潔", "#雨季保養"],
    imagePrompt:
      "Realistic square shop photo: several everyday shoes on a clean inspection bench, one insole partly removed, staff hand checking inner lining, tidy laundry and shoe-care counter, natural light, no logo, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "窗簾下擺灰塵與濕氣痕",
    opener: "窗簾最容易被忽略的是下擺，靠近地板和窗邊的位置常常有灰塵、濕氣痕和不均勻暗沉。",
    context:
      "如果房間通風不好，下擺濕氣和灰塵會黏在布料上，清潔方式要看布料厚度和是否容易縮水。",
    inspection:
      "我們會先看窗簾材質、下擺髒污、掛勾結構和洗標限制，再判斷能不能水洗、需要分件或保守處理。",
    cta: "窗簾要整理前，可以拍整片、下擺和洗標，我們幫你看適合怎麼清。",
    hashtags: ["#私享家洗衣店", "#窗簾清潔", "#居家布品", "#布品保養"],
    imagePrompt:
      "Realistic square shop photo: curtain fabric folded on a laundry inspection counter, lower hem dust marks visible, staff hand checking fabric thickness and hook area, bright clean shop lighting, no logo, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "share-worthy-care"
  }
];

const situationPlans: SlotTemplate[] = [
  {
    topic: "雨後鞋櫃收納前的小檢查",
    opener: "雨後回家，把鞋子直接收進鞋櫃前，可以先看鞋底邊和鞋內是不是還有濕氣。",
    context:
      "很多味道不是當天就出現，而是濕氣悶在鞋內幾天後才變明顯，鞋櫃也會跟著有悶味。",
    inspection:
      "我們會看鞋底邊泥灰、鞋墊濕度、鞋面材質和內裡氣味，再判斷需要通風、除味，還是送來做清潔。",
    cta: "如果鞋子雨後還有味道，拍鞋內、鞋底邊和鞋面給我們看。",
    hashtags: ["#私享家洗衣店", "#雨季保養", "#鞋櫃保養", "#鞋子清潔"],
    imagePrompt:
      "Realistic square shop photo: rainy-day shoes on a clean laundry counter with sole edges and inner lining visible, absorbent cloth nearby, staff hand checking moisture, warm documentary shop lighting, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "健身後運動鞋與毛巾分開整理",
    opener: "健身後的運動鞋和毛巾不要只看乾不乾，汗味來源其實很不一樣。",
    context:
      "毛巾吸汗快、運動鞋內裡悶得久，如果一起堆在袋子裡，味道會互相影響，回家後也更難判斷來源。",
    inspection:
      "我們會分別看毛巾纖維、鞋墊、鞋內濕氣和鞋面材質，再判斷哪些要清潔、哪些只需要先通風。",
    cta: "健身包有味道時，可以拍毛巾、鞋內和鞋袋內側給我們判斷。",
    hashtags: ["#私享家洗衣店", "#運動鞋清潔", "#毛巾清潔", "#除味保養"],
    imagePrompt:
      "Realistic square shop photo: gym towel and athletic shoes separated on a clean inspection counter, staff hand checking shoe interior, tidy laundry shop setting, natural light, no logo, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "object-proof"
  },
  {
    topic: "旅行回來先處理外套與行李灰塵",
    opener: "旅行回來最容易忽略的是外套袖口、行李箱輪邊和包包底部，這些地方一路都在接觸外面的灰塵。",
    context:
      "如果直接把外套掛回衣櫃、行李箱推進房間，外面的髒污也會跟著進到日常收納空間。",
    inspection:
      "我們會先看外套領口袖口、包包底部、行李箱把手和輪邊，再判斷哪些需要清潔、哪些只要外觀整理。",
    cta: "旅行回來要整理，可以把外套、包底和輪邊照片傳來，我們幫你排優先順序。",
    hashtags: ["#私享家洗衣店", "#旅行後整理", "#衣物清潔", "#行李箱清潔"],
    imagePrompt:
      "Realistic square shop photo: travel jacket, handbag bottom, and suitcase wheel area arranged on a clean inspection counter, staff hand pointing to dust, premium documentary laundry shop style, no readable text, no logo.",
    visualRoute: "customer-consultation",
    trafficRoute: "share-worthy-care"
  },
  {
    topic: "孩子上學鞋襪的泥灰與汗味",
    opener: "孩子的上學鞋襪常常不是髒在單一位置，而是鞋底泥灰、鞋內汗味和襪子纖維一起累積。",
    context:
      "放學後如果直接丟進鞋櫃或洗衣籃，味道會悶住，鞋邊灰痕也會越來越明顯。",
    inspection:
      "我們會先看鞋面材質、鞋底邊、鞋墊能不能拆和襪子纖維狀態，再判斷適合清潔或分開處理。",
    cta: "上學鞋如果開始有味道，拍鞋內、鞋底邊和鞋面，我們先幫你看。",
    hashtags: ["#私享家洗衣店", "#童鞋清潔", "#鞋子除味", "#台中洗鞋"],
    imagePrompt:
      "Realistic square shop photo: children's school shoes on a clean counter with sole edges and insole visible, small towel nearby, staff hand checking material gently, bright practical shop lighting, no readable text, no logo.",
    visualRoute: "macro-detail",
    trafficRoute: "object-proof"
  },
  {
    topic: "週末大掃除後的布品分袋",
    opener: "週末大掃除整理出來的布品，不建議全部塞同一袋，棉被、外套、抱枕的髒污來源不一樣。",
    context:
      "有些是睡眠味、有些是灰塵、有些是飲料或手汗痕，混在一起送洗前也比較難判斷處理順序。",
    inspection:
      "我們會在櫃台先分材質、厚度、味道和髒污位置，確認哪些適合一起整理，哪些需要分開處理。",
    cta: "家裡整理出一袋布品時，可以先拍袋內物件和洗標，我們幫你分。",
    hashtags: ["#私享家洗衣店", "#布品收納", "#大掃除整理", "#台中洗衣店"],
    imagePrompt:
      "Realistic square shop photo: bedding, jacket, and cushion cover sorted into separate neat piles on a laundry counter, staff hand labeling categories without readable text, premium clean documentary style, no logo.",
    visualRoute: "shop-inspection",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "約會前包包與白鞋的邊角整理",
    opener: "出門前整體看起來乾淨，常常取決於包包四角、白鞋鞋邊和外套袖口這些小地方。",
    context:
      "邊角暗沉不一定很嚴重，但在近距離看會很明顯，尤其白鞋和淺色包更容易放大使用痕跡。",
    inspection:
      "我們會看包角材質、白鞋膠邊、鞋面灰痕和袖口狀態，再判斷哪些能快速整理、哪些需要完整清潔。",
    cta: "如果有重要行程，先拍包角、鞋邊和袖口，我們幫你看時間來不來得及。",
    hashtags: ["#私享家洗衣店", "#白鞋清潔", "#包包清潔", "#出門前整理"],
    imagePrompt:
      "Realistic square shop photo: white sneakers, light handbag corner, and jacket cuff arranged on a clean care counter, staff hand comparing edge details, refined practical shop lighting, no readable text, no logo.",
    visualRoute: "macro-detail",
    trafficRoute: "dwell-detail"
  },
  {
    topic: "梅雨季衣櫃打開有味道時",
    opener: "梅雨季衣櫃一打開有悶味，不一定是整櫃衣服都髒，常常是幾件厚衣物或布品帶著濕氣。",
    context:
      "外套、棉被、抱枕和厚帽T比較容易留味道，如果沒有分開看，會誤以為全部都需要重洗。",
    inspection:
      "我們會先看物件厚度、收納時間、味道來源和布料狀態，判斷要清潔、除味，還是先做通風乾燥。",
    cta: "衣櫃有味道時，先挑最厚或最常穿的幾件拍給我們看。",
    hashtags: ["#私享家洗衣店", "#梅雨季保養", "#衣櫃除味", "#布品清潔"],
    imagePrompt:
      "Realistic square shop photo: several folded thick garments and bedding pieces on a clean laundry counter, staff hand sorting by fabric thickness, soft daylight, premium practical style, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "trust-reset"
  },
  {
    topic: "雨天機車族外套袖口與鞋面",
    opener: "雨天騎車後，外套袖口和鞋面常常比褲管更早吸到雨水、泥點和路面灰。",
    context:
      "如果只是掛起來等乾，袖口汗味和雨水味會混在一起，鞋面泥點也可能留下淡淡痕跡。",
    inspection:
      "我們會看外套袖口材質、防潑水層、鞋面材質和泥點深度，再判斷適合局部處理或整件整理。",
    cta: "騎車淋雨後，可以拍袖口、鞋面和鞋邊，我們先幫你看狀況。",
    hashtags: ["#私享家洗衣店", "#機車通勤", "#雨季保養", "#衣鞋清潔"],
    imagePrompt:
      "Realistic square shop photo: commuter jacket cuff and rain-marked shoes on an inspection counter, staff hand checking sleeve edge and shoe upper, tidy Taiwanese laundry shop, natural light, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "object-proof"
  },
  {
    topic: "餐聚後外套與包包的味道",
    opener: "餐聚回來後，外套和包包有時候不是髒，而是油煙味、香水味和室內味道混在一起。",
    context:
      "味道如果停在布料或皮革表面還好，若悶進內裡和提把，隔天拿出來會更明顯。",
    inspection:
      "我們會分開看外套材質、內裡味道、包包提把和內袋狀態，再判斷需要除味、清潔或保守整理。",
    cta: "如果餐聚後味道很重，拍外套內裡和包包提把，我們幫你判斷。",
    hashtags: ["#私享家洗衣店", "#衣物除味", "#包包保養", "#生活洗護"],
    imagePrompt:
      "Realistic square shop photo: jacket lining and handbag handle inspected on a clean laundry counter, staff hand gently lifting lining, warm premium shop lighting, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "搬家後寢具與窗簾的灰塵",
    opener: "搬家後最容易累積灰塵的不是只有地板，寢具、窗簾和布套在搬運過程也會吃進很多灰。",
    context:
      "這些布品如果直接鋪上或掛回去，灰塵和倉庫味會留在房間裡，睡覺時更容易感覺不舒服。",
    inspection:
      "我們會看布品種類、搬運包裝、灰塵位置和洗標限制，再判斷哪些要先洗、哪些可以除塵整理。",
    cta: "搬家後要整理布品，可以拍寢具、窗簾下擺和洗標給我們看。",
    hashtags: ["#私享家洗衣店", "#搬家整理", "#寢具清潔", "#窗簾清潔"],
    imagePrompt:
      "Realistic square shop photo: bedding and curtain fabric folded on a clean inspection counter after moving, dust brush nearby, staff hand checking fabric hem, premium documentary laundry shop style, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "share-worthy-care"
  },
  {
    topic: "上班包內袋的粉底與筆痕",
    opener: "上班包外觀看起來乾淨，內袋卻常常有粉底、筆痕、收據灰和飲料小痕跡。",
    context:
      "內袋材質通常比較薄，處理太強容易起毛或留下水痕，所以要先看污漬種類和布料狀態。",
    inspection:
      "我們會看內袋布料、筆痕深度、粉底範圍和包包外層材質，再判斷能做局部處理或只能保守整理。",
    cta: "包包內袋髒了，可以拍內袋近照和整包外觀，我們先幫你看。",
    hashtags: ["#私享家洗衣店", "#包包清潔", "#內袋清潔", "#上班包保養"],
    imagePrompt:
      "Realistic square shop photo: open work bag on a clean care counter, inner lining visible with subtle makeup and pen marks, staff hand pointing to lining, premium practical lighting, no logo, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "dwell-detail"
  },
  {
    topic: "換季收鞋前的鞋底邊緣清潔",
    opener: "換季收鞋前，鞋面看起來乾淨還不夠，鞋底邊緣和鞋內味道也要一起看。",
    context:
      "鞋子收進盒子後，殘留泥灰和濕氣會被關在裡面，下次拿出來才會發現變黃、變味或邊緣更暗。",
    inspection:
      "我們會看鞋底邊、鞋墊、內裡和鞋面材質，判斷清潔範圍和收納前乾燥需求。",
    cta: "要收鞋前，先拍鞋底邊、鞋內和鞋面，我們幫你看要不要先整理。",
    hashtags: ["#私享家洗衣店", "#換季收納", "#鞋子清潔", "#鞋子保養"],
    imagePrompt:
      "Realistic square shop photo: shoes prepared for seasonal storage on an inspection table, shoe box nearby, sole edges and inner lining visible, staff hand checking dryness, bright clean shop style, no readable text.",
    visualRoute: "macro-detail",
    trafficRoute: "object-proof"
  },
  {
    topic: "雨傘滴水後包底被弄濕",
    opener: "雨傘收進包裡或放在座位旁時，最容易被忽略的是包底和包角被水氣慢慢弄濕。",
    context:
      "包底濕掉後如果沒有打開通風，內袋和角落會悶出味道，皮革或帆布也可能留下水痕。",
    inspection:
      "我們會看包底材質、包角水痕、內袋濕氣和縫線狀態，再判斷適合除濕、清潔或局部整理。",
    cta: "包包被雨傘弄濕時，先拍包底、包角和內袋，我們幫你看。",
    hashtags: ["#私享家洗衣店", "#包包保養", "#雨季保養", "#包包清潔"],
    imagePrompt:
      "Realistic square shop photo: handbag bottom and corners on a clean counter with folded umbrella nearby, staff hand checking moisture mark, premium Taiwanese laundry care setting, no logo, no readable text.",
    visualRoute: "customer-consultation",
    trafficRoute: "trust-reset"
  },
  {
    topic: "冷氣房外套的味道累積",
    opener: "常放辦公室的冷氣房外套，不一定每天都髒，但領口、肩線和內裡會慢慢累積味道。",
    context:
      "冷氣房乾、通勤濕，外套在兩種環境來回，味道和汗痕會留在接觸皮膚的位置。",
    inspection:
      "我們會看領口、袖口、肩線和內裡材質，再判斷要局部處理、整件清潔，還是收納前整理。",
    cta: "辦公室外套穿久有味道時，拍領口、袖口和內裡給我們看。",
    hashtags: ["#私享家洗衣店", "#外套清潔", "#衣物除味", "#上班族保養"],
    imagePrompt:
      "Realistic square shop photo: office jacket on a hanger at a laundry inspection counter, collar and inner lining visible, staff hand checking shoulder and cuff, clean premium light, no readable text.",
    visualRoute: "shop-inspection",
    trafficRoute: "value-prop-lead"
  },
  {
    topic: "沙發毯久放後的灰味",
    opener: "沙發毯放久了有灰味，不一定是明顯髒污，有時候是皮屑、灰塵和室內濕氣慢慢堆出來。",
    context:
      "常蓋、常折、常靠近地板的位置會比較容易卡味道，收起來前如果沒處理，下次拿出來會更悶。",
    inspection:
      "我們會看毯子厚度、纖維種類、味道位置和邊角灰塵，再判斷適合清洗、除味或收納前整理。",
    cta: "沙發毯要收起來前，拍整件和邊角給我們看會比較準。",
    hashtags: ["#私享家洗衣店", "#沙發毯清潔", "#居家布品", "#布品收納"],
    imagePrompt:
      "Realistic square shop photo: sofa throw blanket folded on a clean laundry counter, edge dust visible, staff hand checking fabric pile, soft natural light, premium practical documentary style, no logo.",
    visualRoute: "macro-detail",
    trafficRoute: "share-worthy-care"
  },
  {
    topic: "雨季後第一件要整理的鞋包",
    opener: "雨季過後，不一定要全部鞋包一起整理，先挑最常穿、最常背、最有味道的那幾件看就好。",
    context:
      "真正需要優先處理的通常是白鞋、通勤鞋、上班包和常用外套，因為它們每天接觸濕氣、手汗和路面灰。",
    inspection:
      "我們會先看使用頻率、材質、味道和邊角痕跡，幫你判斷哪些值得先整理，哪些可以再觀察。",
    cta: "如果不知道先整理哪一件，拍三到五個物件給我們，我們幫你排順序。",
    hashtags: ["#私享家洗衣店", "#雨季後整理", "#鞋包清潔", "#台中洗衣店"],
    imagePrompt:
      "Realistic square shop photo: a small selection of shoes, handbag, and jacket arranged on a clean care counter for prioritizing after rainy season, staff hand comparing items, premium documentary lighting, no readable text, no logo.",
    visualRoute: "customer-consultation",
    trafficRoute: "value-prop-lead"
  }
];

function dayIndex(date: string): number {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value)) throw new Error(`Invalid date: ${date}`);
  return Math.floor(value / 86_400_000);
}

function templateFor(date: string, category: Category): SlotTemplate {
  const plans = category === "知識文" ? knowledgePlans : situationPlans;
  const plan = plans[dayIndex(date) % plans.length];
  if (!plan) throw new Error(`No content plan available for ${date} ${category}`);
  return plan;
}

function captionFromTemplate(template: SlotTemplate): string {
  return [
    template.opener,
    brandLine,
    template.context,
    template.inspection,
    template.cta,
    template.hashtags.join(" ")
  ].join("\n\n");
}

function playbookSlotsForDate(date: string): GrowthPlaybookSlot[] | undefined {
  const day = buildGrowthPlaybook().days.find((item) => item.date === date);
  return day?.slots;
}

function cleanTopic(topic: string): string {
  return topic
    .replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/, "")
    .replace(/處理順序$/, "")
    .trim();
}

function careBridgeFor(slot: GrowthPlaybookSlot): string {
  if (slot.seo_sync_page.includes("shirt-suit-dry-cleaning")) {
    return "襯衫的領口袖口、西裝的面料、內襯和飾件，不適合只看表面乾不乾淨；洗標與既有痕跡都會影響送洗判斷。";
  }
  if (slot.seo_sync_page.includes("bedding-duvet-cleaning")) {
    return "床組、棉被和寢具要一起看表布、填充、潮氣與尺寸；收納前已經有味道時，不適合直接密封進櫃子。";
  }
  if (slot.seo_sync_page.includes("plush-doll-cleaning")) {
    return "娃娃與絨毛玩偶要先看填充物、五官、刺繡和黏貼配件；不同結構不能直接套用一般衣物的洗法。";
  }
  if (slot.seo_sync_page.includes("luxury-dry-cleaning")) {
    return "精品與精緻材質要先看洗標、面料、五金、飾件和既有磨損；品牌名稱不能取代實際材質判斷。";
  }
  if (slot.seo_sync_page.includes("white-shoe") || slot.seo_sync_page.includes("shoe-bag")) {
    return "鞋子和包包最容易被忽略的地方，通常不是正面，而是鞋邊、提把、包角、內裡或縫線這些每天被摩擦的位置。";
  }
  if (slot.seo_sync_page.includes("photo-before-laundry")) {
    return "送洗前先把物件狀態拍清楚，比直接問能不能洗更有用；材質、髒污位置和使用時間都會影響判斷。";
  }
  if (slot.seo_sync_page.includes("taichung-xitun")) {
    return "西屯日常通勤、下雨、外食和連假移動，都會讓衣物、鞋包和布品累積不同類型的濕氣與灰塵。";
  }
  return "衣物、寢具和居家布品在收納或常用之後，領口、袖口、縫線、厚布和內層位置通常比表面更早累積味道。";
}

function inspectionFor(slot: GrowthPlaybookSlot): string {
  return "遇到這類狀況，我會先看材質、髒污停留的位置、是否有濕氣或異味，再判斷適合局部處理、整件整理，還是先保守觀察。";
}

function actionCtaFor(slot: GrowthPlaybookSlot): string {
  if (slot.seo_sync_page.includes("photo-before-laundry")) {
    return "你可以先拍正面、近照、內裡或洗標，再傳 LINE，這樣我們比較能先幫你判斷方向。";
  }
  return "如果你也有類似物件，可以先拍正面、近照、邊角、內裡或洗標，再傳 LINE 讓我們初步判斷。";
}

function captionFromPlaybook(slot: GrowthPlaybookSlot): string {
  return [
    slot.hook,
    brandLine,
    careBridgeFor(slot),
    inspectionFor(slot),
    actionCtaFor(slot),
    slot.follow_cta,
    slot.hashtags.join(" ")
  ].join("\n\n");
}

function imagePromptFromPlaybook(slot: GrowthPlaybookSlot): string {
  const topic = cleanTopic(slot.topic);
  const formatPrefix: Record<GrowthFormat, string> = {
    "image-post": "Realistic square shop photo",
    "real-shop-photo": "Realistic square shop photo",
    reel: "Realistic vertical-style reel cover frame",
    "carousel-guide": "Realistic square carousel cover photo",
    poster: "Realistic premium square poster-style campaign image"
  };

  return `${formatPrefix[slot.format]} for 私享家洗衣店: ${topic}. ${slot.image_or_reel_direction} Premium Taiwanese laundry and shoe-care shop mood, clean counter, clear object detail, restrained Apple-like spacing when poster-like, no fake logo, no readable text, no watermark.`;
}

function assertPlaybookCaptionQuality(slot: GrowthPlaybookSlot, caption: string): void {
  const paragraphs = caption.split("\n\n");
  const forbidden = ["畫面維持", "這支內容會用", "短影音題", "轉詢問題", "9:16", "主視覺", "route", "SEO"];
  if (paragraphs[1] !== brandLine) {
    throw new Error(`Invalid playbook caption for ${slot.date} slot ${slot.slot}: brand line must be second paragraph.`);
  }
  if (!caption.includes(slot.follow_cta)) {
    throw new Error(`Invalid playbook caption for ${slot.date} slot ${slot.slot}: missing follow CTA.`);
  }
  if (!slot.hashtags.every((hashtag) => caption.includes(hashtag))) {
    throw new Error(`Invalid playbook caption for ${slot.date} slot ${slot.slot}: missing hashtags.`);
  }
  if (forbidden.some((text) => caption.includes(text))) {
    throw new Error(`Invalid playbook caption for ${slot.date} slot ${slot.slot}: contains planning language.`);
  }
}

function dailySlotFromPlaybook(slot: GrowthPlaybookSlot, config: AppConfig): DailySlot {
  const caption = captionFromPlaybook(slot);
  assertPlaybookCaptionQuality(slot, caption);
  return {
    slot: slot.slot,
    time: slot.time,
    category: slot.slot === 1 ? "知識文" : "情境文",
    topic: slot.topic,
    format: slot.format,
    instagram_caption: caption,
    facebook_caption: caption,
    image_prompt: imagePromptFromPlaybook(slot),
    visual_route: slot.visual_route,
    traffic_route: slot.traffic_route,
    views_target: slot.views_target,
    follower_target: slot.follower_target,
    follow_cta: slot.follow_cta,
    seo_sync_page: slot.seo_sync_page,
    ten_day_review_metric: slot.ten_day_review_metric,
    content_plan_source: "growth-playbook",
    local_image_path: relativeAssetPath(slot.date, slot.slot),
    public_image_url: config.publicImageBaseUrl
      ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, slot.date, slot.slot)
      : "",
    status: "pending"
  };
}

function dailySlotFromTemplate(date: string, schedule: (typeof DAILY_SCHEDULE)[number], config: AppConfig): DailySlot {
  const template = templateFor(date, schedule.category);
  const caption = captionFromTemplate(template);
  return {
    slot: schedule.slot,
    time: schedule.time,
    category: schedule.category,
    topic: template.topic,
    instagram_caption: caption,
    facebook_caption: caption,
    image_prompt: template.imagePrompt,
    visual_route: template.visualRoute,
    traffic_route: template.trafficRoute,
    content_plan_source: "legacy-template",
    local_image_path: relativeAssetPath(date, schedule.slot),
    public_image_url: config.publicImageBaseUrl
      ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, schedule.slot)
      : "",
    status: "pending"
  };
}

export function buildDailyContent(date: string, config: AppConfig): DailyContent {
  const playbookSlots = playbookSlotsForDate(date);
  const slots: DailySlot[] = DAILY_SCHEDULE.map((schedule) => {
    const playbookSlot = playbookSlots?.find((slot) => slot.slot === schedule.slot);
    return playbookSlot ? dailySlotFromPlaybook(playbookSlot, config) : dailySlotFromTemplate(date, schedule, config);
  });

  return {
    date,
    timezone: config.timezone,
    generated_at: new Date().toISOString(),
    slots
  };
}
