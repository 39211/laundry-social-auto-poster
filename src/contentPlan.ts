import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { abTestPlanPath, planForDate, planSlot, type AbDayPlan } from "./abTestPlan";
import {
  buildGitHubPagesCarouselImageUrl,
  buildGitHubPagesImageUrl,
  buildGitHubPagesVideoUrl
} from "./githubPages";
import {
  buildGrowthPlaybook,
  COMPANION_MEDIA_START_DATE,
  type GrowthFormat,
  type GrowthPlaybookSlot
} from "./growthPlaybook";
import { contentCalendarPath, projectRoot, relativeAssetPath, relativeCarouselAssetPath, relativeVideoAssetPath } from "./paths";
import { DAILY_SCHEDULE, getZonedDateParts } from "./scheduler";
import type {
  AppConfig,
  CarouselItem,
  Category,
  DailyContent,
  DailySlot,
  Platform,
  TrafficRoute,
  VisualRoute
} from "./types";
import { withVideoItemProfilePrompt } from "./videoItemProfiles";

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
    template.context,
    template.inspection,
    template.cta,
    `${brandLine}｜台中市區免費到府收送`,
    LINE_CONTACT,
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

// The hook is the first line and, with the shop name gone from block 2, the
// larger half of what Instagram shows before folding. In the playbook it is
// filed rather than written: a category label on the front of 155 of the 180
// hooks, and a fixed tail -- "重點不是急著洗，是先看材質、位置和狀態" -- on 105 of
// them. At a median of 44 characters that leaves about twenty that say anything
// about today. Both ends are stripped so the specific middle leads.
//
// Dated prefixes such as 父親節前 survive: those are real timing, not filing.
function cleanHook(hook: string): string {
  const cleaned = hook
    .replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/, "")
    .replace(/[，,]?\s*重點不是急著洗[，,]\s*是先看材質、位置和狀態/g, "")
    .replace(/[，,]?\s*用\s*15\s*秒看懂材質與狀況判斷/g, "")
    .replace(/[，,。]+$/, "")
    .trim();

  // A hook that was nothing but boilerplate is worse gone than kept.
  return cleaned.length >= 6 ? `${cleaned}。` : hook;
}

// With the shop name gone from block 2, this is the fold line: the last thing
// a scrolling reader sees. Eight variants across 180 posts put the same
// sentence in that position 26 times, so each service carries two and they
// alternate by day. They are written as one plain observation rather than as a
// list of everything that could matter, because a list at the fold reads as a
// specification and gets scrolled past.
// With the shop name gone from block 2, this is the fold line: the last thing
// a scrolling reader sees. Eight variants across 180 posts put the same
// sentence in that position 26 times, so the count of variants now follows how
// often each service actually appears in the plan -- fabric storage carries 70
// of the 180 posts and shoe-and-bag care another 49, so those two get four
// each. Shoes and bags are separate: sharing a branch let a post whose hook was
// about white shoes open with a sentence about handbags.
function pickFor(slot: GrowthPlaybookSlot, variants: string[]): string {
  return variants[dayIndex(slot.date) % variants.length] ?? variants[0] ?? "";
}

/**
 * shoe-bag-care covers two objects, and the hook comes from the plan rather
 * than from here. Rotating the blocks purely by day therefore produced posts
 * whose hook was about a handbag and whose every other line was about shoes.
 * The object is read off the hook so the rest of the caption follows it.
 */
function shoeOrBag(slot: GrowthPlaybookSlot): "shoe" | "bag" {
  const text = `${slot.hook} ${slot.topic}`;
  if (/包/.test(text) && !/鞋/.test(text)) return "bag";
  if (/鞋/.test(text) && !/包/.test(text)) return "shoe";
  // A hook naming both, or neither, alternates so the pair still varies.
  return dayIndex(slot.date) % 2 === 0 ? "bag" : "shoe";
}

function pickByObject(
  slot: GrowthPlaybookSlot,
  options: { shoe: string[]; bag: string[] }
): string {
  return pickFor(slot, options[shoeOrBag(slot)]);
}

function careBridgeFor(slot: GrowthPlaybookSlot): string {
  const page = slot.seo_sync_page;
  const variants = ((): string[] => {
    if (page.includes("shirt-suit-dry-cleaning")) {
      return [
        "襯衫的領口和袖口不是洗不乾淨，是皮脂氧化。加倍洗衣精只會把布洗薄。",
        "西裝走樣多半從肩線開始。掛錯衣架、擠在衣櫃裡，肩襯塌了就回不去。"
      ];
    }
    if (page.includes("bedding-duvet-cleaning")) {
      return [
        "棉被收櫃前先聞一下。帶著濕氣收，下一季拿出來就是那個味道。",
        "寢具最厚的地方最慢乾。表面摸起來乾了，中間通常還沒。"
      ];
    }
    if (page.includes("plush-doll-cleaning")) {
      return [
        "娃娃可以洗，但不能當一般衣服洗。填充和五官最怕脫水那一段。",
        "絨毛壓塌了不是髒，是纖維倒了。洗法不對，形狀就回不來。"
      ];
    }
    if (page.includes("luxury-dry-cleaning")) {
      return [
        "精品最先出問題的是邊角。邊油磨掉補不回來，要在磨穿前處理。",
        "同一個牌子會用不同的皮。看品牌決定怎麼洗，比看材質更容易出事。"
      ];
    }
    if (page.includes("white-shoe")) {
      return [
        "白鞋泛黃，問題常在中底和鞋邊，不在鞋面。硬刷只會起毛。",
        "白鞋放久了會黃，不是因為髒。那是材質本身在氧化。"
      ];
    }
    if (page.includes("shoe-bag")) {
      return [
        pickByObject(slot, {
          bag: [
            "包包最先變舊的是提把。那不是灰塵，是手汗堆的。",
            "包角和邊油是先磨掉的地方。等到看得出來，通常已經磨進去了。"
          ],
          shoe: [
            "鞋子真正的問題常在鞋口內裡。外面看起來乾，裡面不一定。",
            "鞋底邊那一圈最常被跳過。它決定整雙看起來新不新。"
          ]
        })
      ];
    }
    if (page.includes("photo-before-laundry")) {
      return [
        "同一塊污漬，在領口和在下擺，處理起來是兩回事。位置比種類重要。",
        "沾到當天和放了兩週，能不能救差很多。時間是最關鍵的一個條件。"
      ];
    }
    if (page.includes("taichung-xitun") || page.includes("taichung-citywide")) {
      return [
        "下雨和通勤是兩種不同的髒。雨痕要等乾才浮出來，汗漬則是越放越難救。",
        "台中這幾個月的濕度，衣服收進櫃子前沒乾透，味道就是那時候留下的。"
      ];
    }
    // fabric-storage: 70 of the 180 posts.
    return [
      "衣服收起來之前那一下沒檢查，下次拿出來通常就是味道的來源。",
      "領口、袖口和內層比表面先累積。看起來還好的時候，其實已經開始了。",
      "厚一點的布收進櫃子，摸起來乾不代表乾透。中間那層最慢。",
      "衣櫃的味道多半不是衣櫃的問題，是收進去的時候就帶著了。"
    ];
  })();

  return pickFor(slot, variants);
}

// This block is the one place the shop speaks as itself rather than as a
// service description, so it is the block a returning reader notices first.
// It took a slot and ignored it: the same sentence went out on all sixty of the
// last thirty days' posts. Each service now has two, alternating by day, and
// each says what is actually looked at rather than listing the categories of
// thing that could be looked at.
function inspectionFor(slot: GrowthPlaybookSlot): string {
  const page = slot.seo_sync_page;
  const variants = ((): string[] => {
    // Index 0 is the shirt and index 1 the suit here, matching the care bridge.
    if (page.includes("shirt-suit-dry-cleaning")) {
      return [
        "領口這種黃，我會先確認是布本身黃了，還是只浮在表面。兩種處理方式不一樣，用力洗只會把布洗薄。",
        "西裝我會先看肩線和領片有沒有塌。那比表面髒不髒更決定它還能不能穿出去。"
      ];
    }
    if (page.includes("bedding-duvet-cleaning")) {
      return [
        "棉被我會先聞內層再看表布。濕氣的味道和髒的味道不一樣，處理方式也不同。",
        "寢具我會先摸厚的地方乾透了沒。表面摸起來乾，中間還帶著濕氣，是最常見的狀況。"
      ];
    }
    if (page.includes("plush-doll-cleaning")) {
      return [
        "娃娃我會先看五官是繡的還是黏的。黏的那種怕水也怕脫水，得換一種洗法。",
        "絨毛我會先按一按填充物，確認裡面有沒有硬塊。那比表面髒難處理得多。"
      ];
    }
    if (page.includes("luxury-dry-cleaning")) {
      return [
        "精品我會先看邊角和五金。能處理的時間比大家想的短，拖過頭就只能維持現狀。",
        "這類東西我不太看品牌，先看材質和已經有的磨損。同一個牌子用不同皮，做法就不一樣。"
      ];
    }
    if (page.includes("white-shoe")) {
      return [
        "鞋子我會先看中底和鞋邊。泛黃多半從那裡開始，鞋面反而還好。",
        "白鞋我會先確認是表面髒還是材質本身變色。這兩種能做到的程度差很多。"
      ];
    }
    // shoe-bag-care covers two objects. Every list on this branch alternates
    // bag, shoe, bag, shoe on the same index, because the blocks are picked by
    // the same day number: lists that alternate differently produced a caption
    // that observed a shoe and then asked about a handbag.
    if (page.includes("shoe-bag")) {
      return [
        pickByObject(slot, {
          bag: [
            "包我會先看提把和包角。那兩個地方天天被摸、被撞，比整體髒不髒更說明狀況。",
            "我會先確認邊油還剩多少。磨到底層之後，能做的就只有維持。"
          ],
          shoe: [
            "鞋子我會先翻開鞋口看內裡。那裡的狀況通常比鞋面誠實。",
            "鞋子我會先看鞋墊和後跟內側。腳汗停在那裡，比外面的灰更難處理。"
          ]
        })
      ];
    }
    if (page.includes("photo-before-laundry")) {
      return [
        "照片我會先看髒的位置在哪。同一塊污漬，在領口和在下擺，處理起來是兩回事。",
        "我會先問這件多久沒整理了。有些痕跡還浮在上面，有些已經跟纖維結在一起。"
      ];
    }
    if (page.includes("taichung-xitun")) {
      return [
        "西屯通勤的客人多，我最常看到的是領口和袖口先出問題。那是每天摩擦的位置，跟洗不洗得乾淨無關。",
        "這幾個月我遇到最多的是雨痕。它要等乾了才浮出來，當下擦掉不代表沒事。"
      ];
    }
    // fabric-storage: 70 of the 180 posts.
    return [
      "我會先看髒污停在哪一層。浮在表面的和吃進纖維的，處理方式差很多。",
      "我會先問這件平常怎麼用、多久沒整理。同樣的痕跡，成因不同就不能用同一種做法。",
      "我會先摸厚的地方確認乾透了沒。收進去之前那一步，決定下次拿出來的味道。",
      "我會先分開看正面和內層。內層通常比外面早出狀況，只是看不到。"
    ];
  })();

  return pickFor(slot, variants);
}

// Instagram captions carry no tappable link, and the first 30 days of account
// insights recorded zero profile-link taps. Instagram readers are sent to a
// direct message instead; Facebook keeps LINE, where links do work.
// The first ask was four photographs -- full view, detail, edge, care label --
// before any exchange had happened, on 58 of the last 60 posts. Thirty days of
// that produced no inquiries at all. The ask is now one photo, and it leads
// with the question the reader already has rather than with an instruction.
// Asking for the rest is a reply, not a requirement for writing in.
function actionCtaFor(slot: GrowthPlaybookSlot, platform: Platform): string {
  const channel = platform === "instagram" ? "私訊" : "傳 LINE";
  const page = slot.seo_sync_page;

  const variants = ((): string[] => {
    if (page.includes("white-shoe") || page.includes("shoe-bag")) {
      return [
        `不確定還救不救得回來？拍一張${channel}給我們，先幫你看。`,
        `想問問看能處理到什麼程度？拍一張${channel}就可以。`,
        `台中市區我們到府收，${channel}說一聲就好。`
      ];
    }
    if (page.includes("luxury-dry-cleaning")) {
      return [
        `不確定這件能不能處理？拍一張${channel}，我們先看材質再說。`,
        `捨不得亂試的那件，先拍一張${channel}，我們幫你判斷。`
      ];
    }
    if (page.includes("plush-doll-cleaning")) {
      return [
        `家裡有不敢洗的娃娃？拍一張${channel}，我們先幫你看能不能洗。`,
        `不確定這隻經不經得起洗？拍一張${channel}，我們先看結構。`
      ];
    }
    if (page.includes("bedding-duvet-cleaning")) {
      return [
        `想收之前先清一次？${channel}跟我們說一聲，台中市區我們到府收。`,
        `換季要整理寢具的話，${channel}說一下數量就可以，我們去收。`
      ];
    }
    if (page.includes("taichung-citywide-laundry-pickup") || page.includes("taichung-xitun")) {
      return [
        `台中市區免費到府收送，${channel}跟我們說你在哪一區就可以。`,
        `不用出門，台中市區我們去收。${channel}說個地址和時間就好。`
      ];
    }
    if (page.includes("shirt-suit-dry-cleaning")) {
      return [
        `領口開始黃了？拍一張${channel}，我們先看是哪一種。`,
        `不確定還洗不洗得回來？拍一張${channel}給我們看看。`
      ];
    }
    return [
      `不確定該怎麼處理？拍一張${channel}給我們，先幫你看方向。`,
      `想先問問看再決定？拍一張${channel}，我們幫你判斷。`,
      `收之前想先整理一次？${channel}跟我們說，台中市區到府收。`,
      `不知道該不該送洗？拍一張${channel}，我們老實跟你說。`
    ];
  })();

  return pickFor(slot, variants);
}

// Pre-authored campaign copy is written around LINE. Rewrite the first
// LINE-bearing action phrase so the Instagram version asks for a direct message.
function normalizeInstagramCta(caption: string): string {
  if (caption.includes("私訊")) return caption;

  const rewrites: Array<[RegExp, string]> = [
    [/點個人檔案連結加\s*LINE\s*，\s*傳/, "直接私訊傳"],
    [/點個人檔案連結加\s*LINE/, "直接私訊"],
    [/(?:直接在\s*|在\s*)?LINE\s*傳/, "直接私訊傳"],
    [/\s*LINE\s*/, "私訊"]
  ];

  for (const [from, to] of rewrites) {
    const next = caption.replace(from, to);
    if (next !== caption) return next;
  }
  return caption;
}

// 34 Instagram posts produced zero comments, and a question gives readers
// something to answer. It is deliberately just a question: an explicit "leave a
// comment" on all 180 posts is the pattern Instagram treats as engagement bait,
// and bait suppresses reach rather than earning it. The question has to be
// answerable in a few words from the reader's own home.
function engagementQuestionFor(slot: GrowthPlaybookSlot): string {
  const page = slot.seo_sync_page;
  const variants = ((): string[] => {
    if (page.includes("shirt-suit-dry-cleaning")) {
      return ["你的襯衫比較常出問題的，是領口還是袖口？", "你有幾件襯衫是黃了以後就沒再穿的？"];
    }
    if (page.includes("bedding-duvet-cleaning")) {
      return ["你家的棉被大概多久整理一次？", "你收棉被之前會先曬嗎，還是直接收？"];
    }
    if (page.includes("plush-doll-cleaning")) {
      return ["家裡有沒有那種一直想洗、又不太敢洗的娃娃？", "你家那隻娃娃陪多久了？"];
    }
    if (page.includes("luxury-dry-cleaning")) {
      return ["哪一件是你最不敢自己動手處理的？", "你最常用的那個包，哪裡先磨壞的？"];
    }
    if (page.includes("white-shoe")) {
      return ["你那雙白鞋放多久沒穿了？", "你都怎麼洗白鞋？"];
    }
    if (page.includes("shoe-bag")) {
      return [
        pickByObject(slot, {
          bag: ["你最常背的那個包，哪裡先磨壞的？", "你那個包用多久了？"],
          shoe: ["你有幾雙鞋是因為不知道怎麼洗就一直放著？", "你多久整理一次鞋子？"]
        })
      ];
    }
    if (page.includes("photo-before-laundry")) {
      return ["你送洗前會先拍照嗎？", "你上次遇到不確定能不能洗的，最後怎麼處理？"];
    }
    if (page.includes("taichung-xitun")) {
      return ["你住西屯哪一帶？我們排收送路線時會參考。", "你平常都幾點方便收件？"];
    }
    return [
      "你家最常送洗的是哪一件？",
      "你現在最想處理掉的是哪一件？",
      "你衣櫃裡放最久沒動的是什麼？",
      "你換季整理最卡關的是哪一步？"
    ];
  })();

  return pickFor(slot, variants);
}

// Sending a post to a specific person is the heaviest discovery signal there is,
// and nothing in these captions ever invited it. It goes only on the 19:30
// situation posts, which are the ones a reader would actually forward, and it is
// phrased from the situation rather than as a generic "share this" — a uniform
// share instruction on all 180 posts would be the same bait pattern the question
// was just rescued from.
function shareInviteFor(slot: GrowthPlaybookSlot): string | undefined {
  if (slot.slot !== 2) return undefined;
  const page = slot.seo_sync_page;
  const variants = ((): string[] => {
    if (page.includes("bedding-duvet-cleaning")) {
      return [
        "家裡那位總說「棉被還可以再放一下」的人，這篇可以轉給他。",
        "換季前負責整理寢具的那個人，這篇傳給他。"
      ];
    }
    if (page.includes("shirt-suit-dry-cleaning")) {
      return [
        "如果同事每天穿襯衫上班，這篇可以順手傳給他。",
        "家裡那個襯衫領口都黃了還在穿的人，傳給他。"
      ];
    }
    if (page.includes("white-shoe")) {
      return [
        "認識那種白鞋放到發黃還沒處理的人嗎？傳給他。",
        "那個總說「再穿一次就拿去洗」的朋友，這篇傳給他。"
      ];
    }
    if (page.includes("shoe-bag")) {
      return [
        pickByObject(slot, {
          bag: [
            "朋友那個包背到提把都變色了，這篇傳給他。",
            "那個包用了好幾年沒整理過的朋友，這篇傳給他。"
          ],
          shoe: [
            "認識那種鞋子捨不得丟、又不知道怎麼救的人嗎？傳給他。",
            "家裡鞋櫃塞滿卻幾雙都沒在穿的那個人，這篇傳給他。"
          ]
        })
      ];
    }
    if (page.includes("taichung-citywide-laundry-pickup") || page.includes("taichung-xitun")) {
      return [
        "住台中、又一直抽不出時間送洗的朋友，這篇傳給他最實用。",
        "台中不想出門又要送洗的那個人，這篇傳給他。"
      ];
    }
    return [
      "家裡衣服堆到不想開始整理的那個人，這篇傳給他。",
      "那個每次換季都說「下週再整理」的人，傳給他。",
      "衣櫃塞到關不起來的朋友，這篇傳給他。",
      "家裡負責收衣服的那位，這篇傳給他。"
    ];
  })();

  return pickFor(slot, variants);
}

function withEngagementQuestion(caption: string, slot: GrowthPlaybookSlot): string {
  const question = engagementQuestionFor(slot);
  if (caption.includes(question)) return caption;

  const share = shareInviteFor(slot);
  const tail = share ? `${question}\n\n${share}` : question;
  return caption.replace(slot.follow_cta, `${tail}\n\n${slot.follow_cta}`);
}

// The owner's LINE ID, requested in the caption on 2026-08-07: the videos say
// "LINE 聯絡" but never gave the reader the actual ID to add. It belongs in
// the caption, never burned into the video. One line, right before the
// hashtags, on every post and both platforms.
// A phone number is not a tap target. Instagram bio taps sat at zero for
// twenty-eight days because nothing in any caption could be followed, so the
// contact line now leads with the coded redirect -- tappable on Facebook,
// long-pressable on Instagram, and the only thing that puts a number into the
// GA4 report the ads ladder waits on.
/**
 * Which shoe a topic is about, and the phrase the prompt uses to ask for it.
 *
 * A category is not a subject: every shoe topic used to ask for "navy-and-warm-
 * white sneakers", including 白鞋泛黃, which produced navy canvas shoes for
 * posts about white ones. The topic already says which object it means, and the
 * colour it names is usually the whole point of the post.
 */
const SHOE_SUBJECTS: Array<{ match: RegExp; subject: string }> = [
  { match: /白鞋/, subject: "white leather low-top sneakers with a white rubber midsole" },
  { match: /帆布/, subject: "off-white canvas low-top sneakers" },
  { match: /皮鞋/, subject: "dark brown leather dress shoes" },
  { match: /靴/, subject: "mid-height brown leather boots" },
  { match: /勃肯|拖鞋|涼鞋/, subject: "cork-footbed leather sandals" },
  { match: /運動鞋|球鞋/, subject: "grey-and-white running shoes" }
];
const DEFAULT_SHOE_SUBJECT = "unbranded navy-and-warm-white sneakers";

export function shoeSubjectFor(topic: string): string {
  return SHOE_SUBJECTS.find((entry) => entry.match.test(topic))?.subject ?? DEFAULT_SHOE_SUBJECT;
}

/**
 * A prompt that asks for a different object than the topic names.
 *
 * ERROR-BOOK A1 and A7: change a topic and forget its image_prompt, delete the
 * images and let the placer regenerate from the stale prompt, and every witness
 * agrees -- the manifest, the stamp and the file hashes are all consistent with
 * each other, and all three describe a picture of the wrong object. Nothing
 * else in the chain compares what the caption says to what the prompt asks for.
 *
 * Deliberately reports contradiction rather than requiring the marker to be
 * present. Reel covers describe their subject in their own words ("a tan suede
 * shoe whose nap has flattened"), and demanding a canonical phrase would block
 * every one of them. What is never legitimate is a 白鞋 caption over a prompt
 * that explicitly asks for canvas.
 */
/**
 * Object families for the caption-versus-prompt cross-check.
 *
 * The Chinese side identifies what a topic is about; the English side is the
 * narrow set of nouns whose presence means the prompt asks for that family.
 * Two deliberate constraints, both learned the hard way:
 *
 * Topic patterns use compound words only. Bare 被 is the passive marker --
 * 帆布鞋鞋口被遮住 is a shoe topic containing 被 -- and bare 衣 lives inside
 * 洗衣店, the business's own name. A family that matches grammar instead of
 * objects blocks legitimate days, and a blocked slot 1 is a silent morning.
 *
 * Marker regexes are word-bounded nouns, not adjectives. "quilted" describes
 * down jackets as readily as duvets; \bquilts?\b does not match "quilted", so
 * the adjective cannot vouch for the wrong family.
 *
 * 羽絨 is genuinely ambiguous (羽絨被 bedding, 羽絨外套 clothing), so both
 * sides claim only their compound and bedding is listed first.
 */
const SUBJECT_FAMILIES: Array<{ label: string; topic: RegExp; markers: RegExp }> = [
  { label: "鞋類", topic: /鞋|靴|勃肯/, markers: /\b(sneakers?|shoes?|boots?|sandals?|heels?|loafers?|footwear)\b/i },
  { label: "行李箱", topic: /行李箱/, markers: /\b(suitcases?|luggage|trolley case)\b/i },
  {
    label: "包袋類",
    topic: /書包|背包|皮夾|錢包|提包|皮包|名牌包|精品包|化妝包|托特|手提袋/,
    markers: /\b(handbags?|backpacks?|wallets?|totes?|purses?|satchels?)\b/i
  },
  {
    label: "寢具類",
    topic: /棉被|羽絨被|被套|寢具|毛毯|枕|保潔墊|床單|床組|涼被|睡袋/,
    markers: /\b(duvets?|quilts?|comforters?|bedding|blankets?|pillows?|mattress pads?)\b/i
  },
  {
    label: "衣物類",
    topic: /外套|襯衫|毛衣|大衣|洋裝|西裝|夾克|羽絨衣|牛仔褲|裙|制服|旗袍|禮服/,
    markers: /\b(jackets?|shirts?|sweaters?|coats?|blouses?|dress(?:es)?|trousers|jeans|suits?|uniforms?|gowns?)\b/i
  },
  { label: "絨毛娃娃", topic: /娃娃|絨毛/, markers: /\b(plush|stuffed (?:toys?|animals?)|dolls?)\b/i }
];

export function contradictorySubject(
  topic: string,
  prompt: string
): { expected: string; found: string } | undefined {
  // Family layer first: a duvet caption over a prompt that asks for sneakers
  // is wrong regardless of which sneakers. Contradiction-only in both layers --
  // a prompt that names the right family in its own words passes, because Reel
  // covers describe their subject freely and demanding canonical phrasing
  // would block every one of them. A prompt that names no family at all is no
  // opinion, not a finding.
  const family = SUBJECT_FAMILIES.find((f) => f.topic.test(topic));
  if (family && !family.markers.test(prompt)) {
    const other = SUBJECT_FAMILIES.find((f) => f !== family && f.markers.test(prompt));
    if (other) {
      const found = prompt.match(other.markers)?.[0] ?? other.label;
      return { expected: family.label, found };
    }
  }

  // Fine-grained layer, shoes only: 白鞋 caption over a canvas-shoe prompt is
  // the 2026-08-14 accident, and both prompts are inside the shoe family, so
  // the family layer cannot see it.
  const expected = SHOE_SUBJECTS.find((entry) => entry.match.test(topic));
  if (!expected) return undefined;
  if (prompt.includes(expected.subject)) return undefined;
  const contradiction = SHOE_SUBJECTS.find(
    (entry) => entry !== expected && prompt.includes(entry.subject)
  );
  return contradiction
    ? { expected: expected.subject, found: contradiction.subject }
    : undefined;
}

/**
 * The file-label prefixes the playbook puts in front of a topic.
 *
 * These name the format, not the object: 可收藏 means "this one is worth
 * saving", the same way 先看懂 means "this one explains". Exported because the
 * approval gate's seven-day repeat check kept its own shorter copy of this
 * list, so two posts about completely different objects looked identical to it
 * as long as they shared a label — and from day 31 the playbook labels every
 * knowledge post 可收藏, which would have blocked the morning post every day
 * from 2026-08-16 onward.
 */
export const TOPIC_LABEL_PREFIXES = [
  "先看懂",
  "今天情境",
  "可收藏",
  "細節拆解",
  "到店前判斷",
  "送洗前先問"
] as const;

export const TOPIC_LABEL_PREFIX_RE = new RegExp(`^(${TOPIC_LABEL_PREFIXES.join("|")})：`);

/** Same object-head scan autoApprove uses, applied here as a 15-day pre-check. */
export const TOPIC_REPEAT_WINDOW_DAYS = 15;

const TOPIC_LEAD_INS = /怎麼判斷|怎麼辦|你可能|其實|今天|當天|門市檢查|最髒的|先看|再看/g;

export function topicObjectHead(topic: string): string {
  return topic
    .replace(TOPIC_LABEL_PREFIX_RE, "")
    .replace(/[（(].*?[)）]/g, "")
    .replace(TOPIC_LEAD_INS, "")
    .replace(/[：:，,。!？?\s]/g, "")
    .slice(0, 8);
}

/** Shared 3-character object gram, or undefined when the two topics do not collide. */
export function repeatingObjectGram(left: string, right: string): string | undefined {
  const head = topicObjectHead(left);
  const other = topicObjectHead(right);
  for (let i = 0; i + 3 <= other.length; i += 1) {
    const gram = other.slice(i, i + 3);
    if (/^[一-鿿]{3}$/.test(gram) && head.includes(gram)) return gram;
  }
  return undefined;
}

export function topicRepeatsInWindow(topic: string, others: string[]): string | undefined {
  for (const other of others) {
    const gram = repeatingObjectGram(topic, other);
    if (gram) return gram;
  }
  return undefined;
}

function addUtcDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function loadAbTestPlanSync(root: string): AbDayPlan[] {
  try {
    const raw = readFileSync(abTestPlanPath(root), "utf8").replace(/^\uFEFF/u, "");
    const parsed = JSON.parse(raw) as AbDayPlan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recentCalendarTopics(date: string, days: number, root: string): string[] {
  const topics: string[] = [];
  for (let back = 1; back <= days; back += 1) {
    const prevDate = addUtcDays(date, -back);
    try {
      const raw = readFileSync(contentCalendarPath(prevDate, root), "utf8").replace(/^\uFEFF/u, "");
      const parsed = JSON.parse(raw) as { slots?: Array<{ topic?: string }> };
      for (const slot of parsed.slots ?? []) {
        if (slot.topic) topics.push(slot.topic);
      }
    } catch {
      // Missing days are not a collision. The gate only compares what actually ran.
    }
  }
  return topics;
}

/**
 * A paused evening half is not "a reel with a different concept". It is no
 * reel. Playbook Tuesdays/Thursdays/Saturdays still emit format=reel, which is
 * the legacy fallback that then invited scheduleReel to drop a recently-aired
 * concept onto the empty night slot.
 */
function asPlaybookImageSlot(slot: GrowthPlaybookSlot): GrowthPlaybookSlot {
  if (slot.format !== "reel") return slot;
  return {
    ...slot,
    format: "image-post",
    image_or_reel_direction:
      `門市隨手拍:${slot.visual_route} 路線,物件放在使用中的櫃台,手部檢查材質或邊角,日光燈加窗光,不放假品牌、不做誇張對比。`
  };
}

function playbookSlotForPausedEvening(
  playbookSlot: GrowthPlaybookSlot,
  occupiedTopics: string[]
): GrowthPlaybookSlot {
  const primary = asPlaybookImageSlot(playbookSlot);
  if (!topicRepeatsInWindow(primary.topic, occupiedTopics)) return primary;

  const playbook = buildGrowthPlaybook();
  for (const day of playbook.days) {
    const candidate = day.slots.find((item) => item.slot === 2);
    if (!candidate || candidate.topic === playbookSlot.topic) continue;
    const rebased = asPlaybookImageSlot({
      ...candidate,
      date: playbookSlot.date,
      day: playbookSlot.day,
      slot: playbookSlot.slot,
      time: playbookSlot.time
    });
    if (!topicRepeatsInWindow(rebased.topic, occupiedTopics)) return rebased;
  }
  return primary;
}

const LINE_REDIRECT = "https://39211.github.io/go/line.html?source=post";
export const LINE_CONTACT = `直接點這裡問:${LINE_REDIRECT}(或加 LINE:0968327653)`;

function withLineContact(caption: string): string {
  // Testing for the phone number was the wrong test: a caption that merely
  // printed the digits ("加 LINE 直接問：0968327653") satisfied it and opted
  // itself out of the coded link -- which is the only thing GA4 can count.
  // Every scheduled Reel did exactly that. Test for the tappable link.
  if (caption.includes(LINE_REDIRECT)) return caption;
  const blocks = caption.split("\n\n");
  const hashtagIndex = blocks.findIndex((block) => block.startsWith("#"));
  if (hashtagIndex === -1) return `${caption}\n\n${LINE_CONTACT}`;
  blocks.splice(hashtagIndex, 0, LINE_CONTACT);
  return blocks.join("\n\n");
}

// The owner made the price list public (data/prices.json, 109 items) and the
// distribution report identified "no price, no landmark" as conversion killer
// number three: a reader with a real need saves the post that already answers
// 多少錢. One line, matched to the topic's object family, ahead of the LINE line.
const PRICE_LINES: Array<{ match: RegExp; line: string }> = [
  { match: /名牌包|精品包|皮包/, line: "參考價：皮包包 $1000、名牌包 $1500 起（發霉特污另計）" },
  { match: /書包|背包/, line: "參考價：背包清洗 $500（水洗價，以實際報價為主）" },
  { match: /白鞋|球鞋|運動鞋|帆布鞋/, line: "參考價：一般運動鞋 $250、皮類 $300（水洗價）" },
  { match: /皮鞋|靴/, line: "參考價：皮鞋 $400、低靴 $350、高靴 $550（水洗價）" },
  { match: /皮衣/, line: "參考價：皮衣 $1200、特殊皮衣 $2000（發霉另計）" },
  { match: /襯衫|制服/, line: "參考價：襯衫 $70、整燙 $50（水洗價）" },
  { match: /西裝|大衣/, line: "參考價：西裝背心 $80、長大衣 $300（水洗價，乾洗另計）" },
  { match: /羽絨/, line: "參考價：羽絨外套 $280、羽絨羊毛被 $800（水洗價）" },
  { match: /棉被|床組|寢具|被套/, line: "參考價：棉被單人 $350、雙人 $500、床組四件套 $300（水洗價）" },
  { match: /窗簾|地毯/, line: "參考價：窗簾地毯依尺寸報價，LINE 傳照片先估" },
  { match: /娃娃|絨毛/, line: "參考價：絨毛娃娃依大小報價，LINE 傳照片先估" }
];

function withPriceLine(caption: string, topic: string): string {
  if (caption.includes("參考價")) return caption;
  // A mixed-object topic (七夕 shoes-and-bag checks) must not carry a single
  // family's price -- the wrong number under the wrong object reads as bait.
  // Family-level check first: the price rules are finer-grained than the
  // object families, so 白鞋+包角 matched only the sneaker rule and slipped by.
  const families = [/鞋|靴/, /包/, /衣|裝|衫|服|袍/, /被|床|寢|毯|枕/].filter((f) => f.test(topic));
  if (families.length > 1) return caption;
  const matches = PRICE_LINES.filter((entry) => entry.match.test(topic));
  if (matches.length !== 1) return caption;
  const rule = matches[0];
  if (!rule) return caption;
  const blocks = caption.split("\n\n");
  const lineIndex = blocks.findIndex((block) => block.includes("0968327653"));
  const hashtagIndex = blocks.findIndex((block) => block.startsWith("#"));
  const insertAt = lineIndex !== -1 ? lineIndex : hashtagIndex !== -1 ? hashtagIndex : blocks.length;
  blocks.splice(insertAt, 0, rule.line);
  return blocks.join("\n\n");
}

// Hashtag science v1 (2026 practice): a tag set works as a ladder -- a few
// large-reach tags for the algorithm's topic classification, several mid-size
// local tags where a small account can actually rank, and precise small tags
// that match buying intent. The playbook's per-slot tags are mostly brand and
// generic care tags, so the ladder fills in what the topic needs. Capped at
// 12 total: past ~15, 2026 guidance treats tag walls as spam signal.
const HASHTAG_LARGE = ["#台中", "#台中美食圈外的日常", "#taichung"];
const HASHTAG_LOCAL = ["#台中洗衣店", "#西屯", "#逢甲", "#西屯洗衣", "#台中生活"];
const HASHTAG_INTENT: Array<{ match: RegExp; tags: string[] }> = [
  { match: /鞋|靴/, tags: ["#台中洗鞋", "#洗鞋推薦", "#球鞋清洗"] },
  { match: /包|袋/, tags: ["#洗包包", "#精品包保養", "#名牌包清潔"] },
  { match: /被|床|寢|毯|枕/, tags: ["#棉被送洗", "#寢具清潔", "#換季收納"] },
  { match: /衣|裝|衫|服|羽絨/, tags: ["#衣物送洗", "#乾洗", "#台中乾洗"] },
  { match: /娃娃|絨毛/, tags: ["#娃娃清洗", "#絨毛娃娃"] },
  { match: /窗簾|地毯/, tags: ["#窗簾清洗", "#居家清潔"] }
];

function upgradeHashtags(existing: string[], topic: string): string[] {
  const intent = HASHTAG_INTENT.find((entry) => entry.match.test(topic))?.tags ?? [];
  const ladder = [...existing, ...intent, ...HASHTAG_LOCAL.slice(0, 3), HASHTAG_LARGE[0] ?? "#台中"];
  return [...new Set(ladder)].filter((tag): tag is string => Boolean(tag)).slice(0, 12);
}

function withUpgradedHashtags(caption: string, topic: string): string {
  const blocks = caption.split("\n\n");
  const tagIndex = blocks.findIndex((block) => block.startsWith("#"));
  if (tagIndex === -1) return caption;
  const tags = (blocks[tagIndex] ?? "").split(/\s+/).filter((tag) => tag.startsWith("#"));
  blocks[tagIndex] = upgradeHashtags(tags, topic).join(" ");
  return blocks.join("\n\n");
}

/**
 * The contact line, the price line and the hashtag ladder, applied in that
 * order. Exported because Reel captions are assembled elsewhere and were
 * therefore getting none of the three: no tappable link, no price, and four
 * generic tags with no local one among them. A rule that only one caption
 * builder obeys is not a rule.
 */
export function withSharedCaptionRules(caption: string, topic: string): string {
  return withUpgradedHashtags(withPriceLine(withLineContact(caption), topic), topic);
}

function captionFromPlaybook(slot: GrowthPlaybookSlot, platform: Platform): string {
  const caption = baseCaptionFromPlaybook(slot, platform);
  return withSharedCaptionRules(withEngagementQuestion(caption, slot), slot.topic);
}

// Pre-authored playbook captions carry the same defect the assembled ones did:
// a bare shop name in block 2, where Instagram folds. Dropping the block moves
// the next real sentence up into that position. The name still reaches the
// reader through the hashtags and the follow line.
function demoteBrandLine(caption: string): string {
  const blocks = caption.split("\n\n");
  if (blocks[1] !== brandLine) return caption;
  return [blocks[0], ...blocks.slice(2)].join("\n\n");
}

function baseCaptionFromPlaybook(slot: GrowthPlaybookSlot, platform: Platform): string {
  const explicitCaption = platform === "facebook" ? slot.facebook_caption : slot.instagram_caption;
  if (explicitCaption) {
    const demoted = demoteBrandLine(explicitCaption);
    return platform === "instagram" ? normalizeInstagramCta(demoted) : demoted;
  }

  if (slot.campaign === "taichung-free-pickup-delivery") {
    const actionCta = platform === "instagram" ? slot.instagram_action_cta ?? slot.action_cta : slot.action_cta;
    if (!slot.story || !slot.service_message || !actionCta) {
      throw new Error(`Invalid pickup-delivery campaign copy for ${slot.date} slot ${slot.slot}.`);
    }
    const caption = [
      cleanHook(slot.hook),
      slot.story,
      slot.service_message,
      actionCta,
      slot.follow_cta,
      slot.hashtags.join(" ")
    ].join("\n\n");
    return platform === "instagram" ? normalizeInstagramCta(caption) : caption;
  }

  // Instagram folds the caption at roughly 125 characters, so whatever sits in
  // block 2 is the last thing most readers see. It held the shop name -- which
  // is already the account handle directly above the caption -- on every post.
  // The observation the hook promises goes there instead, and the shop name
  // moves down to the follow line where it is doing actual work.
  return [
    cleanHook(slot.hook),
    careBridgeFor(slot),
    inspectionFor(slot),
    actionCtaFor(slot, platform),
    slot.follow_cta,
    slot.hashtags.join(" ")
  ].join("\n\n");
}

// Instagram's 2026 ranking notes say plainly that raw, real human content is
// rewarded over polished AI-looking material. "Premium", "editorial" and
// Apple-like spacing were pushing every frame toward an advert, which is the
// look that reads as synthetic and loses watch time. These ask instead for what
// a shop owner's own phone would produce.
// "Realistic texture" alone still yields a brand-new item, and a brand-new
// item contradicts every caption this shop writes: a post about damp shoe
// linings shipped with a spotless boutique product shot. The wear line makes
// the item look like something a customer actually brought in.
// Style master v1 (data/style-master.md is the human-readable source of
// record). Scene DNA comes from the shop's real Google Maps photos -- the
// pink cutting mat, white slat-wall and covered-garment conveyor are what
// 私享家 actually looks like -- and the photographic spec follows the
// 船長AI視界 method: lens feel, depth-of-field feel, light with direction
// and falloff, ONE tone anchor, and film grain, so "realistic" is expressed
// as visible camera behaviour instead of the word "realistic".
// Style master v2 (data/style-master.md). v1's film-look stack (35mm lens
// feel, Portra tone, film grain) contradicted "shot on a phone" -- phones
// don't produce film stock artifacts, and the mismatch itself reads as AI.
// The cross-family red team also split the plastic ban (garment covers in the
// background ARE plastic; only the hero must not look waxy), merged the three
// self-contradicting depth-of-field clauses, moved wear enumeration out to
// the topic line, and rotates the third background anchor because identical
// backgrounds across daily posts invite Meta's duplicate-content dampening.
const BACKGROUND_ANCHORS = [
  "a garment conveyor with plastic-covered clothes softly out of focus in the background",
  "glass display shelves with rows of cleaned sneakers softly out of focus in the background",
  "retail shelves with fabric-care products softly out of focus in the background"
];

function phoneRealism(anchorIndex = 0): string {
  const anchor = BACKGROUND_ANCHORS[anchorIndex % BACKGROUND_ANCHORS.length];
  return (
    "Shot on a phone, slightly high handheld angle looking down about 15 degrees, the featured object " +
    "filling roughly 35-50% of the frame height with natural phone-camera depth: object sharp, background " +
    `softened but still recognizable. Scene: a light counter with a pink cutting mat, white slat-wall panels behind, ${anchor}, ` +
    "everyday Taiwanese laundry shop clutter at the frame edges. Key light from the storefront window on one side, " +
    "fluorescent ceiling fill, gentle shadow falloff, neutral warm indoor tone, slight handheld framing imperfection. " +
    "The featured item's condition matches the topic exactly, at the positions the topic names, with visible material " +
    "grain, a real contact shadow under the object, and believable weight; it must not look brand new unless the topic " +
    "is the after state. Any shop paperwork or labels in the background must be out of focus and unreadable. " +
    "The featured object must not look waxy or plastic-coated. Not editorial, not cinematic, not studio lighting, " +
    "no oversaturated colors, no boutique or showroom interior, no stock-photo feel, no laundry basket as a featured " +
    "object, no readable text on the featured object, no brand logos or logo-like marks, no watermark."
  );
}

const PHONE_REALISM = phoneRealism(0);

function imagePromptFromPlaybook(slot: GrowthPlaybookSlot): string {
  const topic = cleanTopic(slot.topic);
  const formatPrefix: Record<GrowthFormat, string> = {
    "image-post": "Ordinary square shop photo",
    "real-shop-photo": "Ordinary square shop photo",
    reel: "Ordinary vertical phone frame",
    "carousel-guide": "Ordinary square carousel cover photo",
    poster: "Ordinary square campaign photo"
  };

  return `${formatPrefix[slot.format]} for 私享家洗衣店: ${topic}. ${slot.image_or_reel_direction} ${PHONE_REALISM}`;
}

// Carousel continuity (2026-08-17): four slides used to be four different
// items because each prompt only said "the same complete 衣物 item". Reel
// stills already lock identity with SHARED_STILL_PROMPT / middle-act edit
// language. The passport is the carousel equivalent: slide 1 names one
// physical object, and every later slide must repeat that text plus the
// same-garment sentence. Scene DNA stays on one pink-mat counter.
export const SAME_GARMENT_CONTINUITY =
  "the SAME physical garment as slide 1, same color, same fabric, same wear marks, same counter and lighting";

export const CAROUSEL_SCENE_LOCK =
  "SCENE LOCK: the same light counter with the same pink cutting mat and the same wall family on every slide; do not change location, backdrop, or room across slides.";

export interface CarouselPromptInput {
  date: string;
  slot?: number;
  topic: string;
  caption?: string;
  seo_sync_page?: string;
}

interface ObjectSpec {
  noun: string;
  lockNote: string;
  material: string;
  wear: string;
}

function topicBody(topic: string): string {
  return cleanTopic(topic).replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)[:：]/, "");
}

function wearKindFromTopic(topic: string): string {
  if (/變灰|泛灰/.test(topic)) return "sun-faded grey";
  if (/發黃|泛黃/.test(topic)) return "yellowing";
  if (/濕|潮/.test(topic)) return "trapped moisture";
  if (/汗/.test(topic)) return "sweat residue";
  if (/油/.test(topic)) return "oil darkening";
  if (/泥/.test(topic)) return "mud shadow in the weave";
  return "honest everyday wear";
}

function namedSpotsFromTopic(topic: string): string[] {
  const spots: string[] = [];
  if (/肩線/.test(topic)) spots.push("shoulder line");
  if (/側縫/.test(topic)) spots.push("side seams");
  if (/領口|衣領/.test(topic)) spots.push("collar");
  if (/袖口/.test(topic)) spots.push("cuffs");
  if (/腋下/.test(topic)) spots.push("underarms");
  if (/內層|內裡/.test(topic)) spots.push("inner lining");
  if (/下擺/.test(topic)) spots.push("hem");
  if (/鞋邊|膠條/.test(topic)) spots.push("rubber foxing strip at the midsole edge");
  if (/鞋頭/.test(topic)) spots.push("toe box");
  if (/鞋帶孔/.test(topic)) spots.push("eyelet area around the lace holes");
  if (/提把/.test(topic)) spots.push("handle");
  if (/包角/.test(topic)) spots.push("bag corners");
  return spots;
}

function objectSpecFromTopic(topic: string): ObjectSpec {
  const t = topicBody(topic);
  const kind = wearKindFromTopic(t);
  const spots = namedSpotsFromTopic(t);
  const wearAt = (fallback: string) => (spots.length > 0 ? `${kind} at the ${spots.join(" and ")}` : fallback);

  // 深色衣服 is the 8/17 failure case: a category word, not a garment. Lock
  // one noun (tee, not shirt) so four slides cannot invent four silhouettes.
  if (/深色/.test(t) && /衣/.test(t)) {
    return {
      noun: "dark cotton tee",
      lockNote: "object locked as dark cotton tee, not a shirt, not a hoodie, not a jacket",
      material: "charcoal cotton jersey knit",
      wear: wearAt("sun-faded grey along the shoulder line and both side seams")
    };
  }

  if (/鞋/.test(t) && /包/.test(t)) {
    return {
      noun: "paired everyday sneaker and one fabric handbag as a single inspection set",
      lockNote: "object locked as one sneaker-and-bag inspection set",
      material: "worn fabric and leather-look surfaces",
      wear: wearAt("honest everyday wear at the named contact points")
    };
  }

  if (/童鞋|鞋|靴|勃肯|拖鞋|涼鞋/.test(t)) {
    const shoe = shoeSubjectFor(t);
    return {
      noun: `paired set of two ${shoe}`,
      lockNote: `object locked as ${shoe}`,
      material: shoe,
      wear: wearAt(`${kind} at the positions the topic names`)
    };
  }

  if (/床單|被套|棉被|床組|枕/.test(t)) {
    return {
      noun: "complete folded warm-white cotton duvet cover with a thin navy piping edge",
      lockNote: "object locked as one folded warm-white cotton duvet cover",
      material: "warm-white cotton with thin navy piping",
      wear: wearAt("sleep odor and trapped moisture in the thickest channel")
    };
  }

  if (/襯衫/.test(t) && /西裝/.test(t)) {
    return {
      noun: "white cotton dress shirt laid with a navy wool suit jacket",
      lockNote: "object locked as one shirt-and-suit inspection pair",
      material: "white cotton shirting and navy wool",
      wear: wearAt("collar ring and shoulder-line collapse")
    };
  }

  if (/襯衫/.test(t)) {
    return {
      noun: "white cotton dress shirt",
      lockNote: "object locked as a white cotton dress shirt",
      material: "white cotton shirting",
      wear: wearAt("collar and underarm yellowing")
    };
  }

  if (/牛仔/.test(t)) {
    return {
      noun: "pair of indigo denim jeans",
      lockNote: "object locked as indigo denim jeans",
      material: "indigo cotton denim",
      wear: wearAt("fade at the thigh and hem")
    };
  }

  if (/娃娃|玩偶/.test(t)) {
    return {
      noun: "medium plush doll",
      lockNote: "object locked as one plush doll",
      material: "soft pile plush with visible seams",
      wear: wearAt("matted pile on the hugged side")
    };
  }

  if (/包/.test(t)) {
    return {
      noun: "structured everyday handbag",
      lockNote: "object locked as one structured handbag",
      material: "pebbled leather-look body with stitched handles",
      wear: wearAt("handle darkening and corner edge-paint wear")
    };
  }

  if (/行李箱/.test(t)) {
    return {
      noun: "soft-sided fabric suitcase",
      lockNote: "object locked as one fabric suitcase",
      material: "woven suitcase fabric with wheeled base",
      wear: wearAt("dust at the wheel edge and handle")
    };
  }

  if (/羽絨/.test(t)) {
    return {
      noun: "quilted down jacket",
      lockNote: "object locked as one quilted down jacket",
      material: "nylon-shell quilted down",
      wear: wearAt("flattened loft in the body channels")
    };
  }

  if (/西裝/.test(t)) {
    return {
      noun: "navy wool suit jacket",
      lockNote: "object locked as one navy wool suit jacket",
      material: "navy wool suiting",
      wear: wearAt("softened shoulder line and collar roll")
    };
  }

  if (/外套|大衣|夾克/.test(t)) {
    return {
      noun: "everyday fabric jacket",
      lockNote: "object locked as one everyday fabric jacket",
      material: "worn woven jacket cloth",
      wear: wearAt("collar and cuff darkening")
    };
  }

  return {
    noun: "complete worn laundry item matching the topic",
    lockNote: "object locked to the single item the topic names",
    material: "honest used fabric",
    wear: wearAt(`${kind} at the positions the topic names`)
  };
}

export function garmentPassportFromTopic(topic: string): string {
  const spec = objectSpecFromTopic(topic);
  return (
    `OBJECT PASSPORT: exactly one ${spec.noun} (${spec.lockNote}); ` +
    `color/material: ${spec.material}; wear marks: ${spec.wear}.`
  );
}

const SPOT_LEXICON: Array<[RegExp, string]> = [
  [/肩線/, "shoulder line"],
  [/側縫/, "side seams"],
  [/領口|衣領/, "collar"],
  [/袖口/, "cuffs"],
  [/腋下/, "underarms"],
  [/內層|內裡/, "inner lining"],
  [/下擺/, "hem"],
  [/鞋邊|膠條|中底/, "rubber foxing strip at the midsole edge"],
  [/鞋頭/, "toe box"],
  [/鞋帶孔/, "eyelet area around the lace holes"],
  [/鞋墊/, "insole"],
  [/鞋口/, "shoe opening"],
  [/提把/, "handle"],
  [/包角/, "bag corners"],
  [/邊油/, "edge paint"],
  [/五金/, "hardware"]
];

function translateSpot(zh: string): string {
  const hits = [...new Set(SPOT_LEXICON.filter(([re]) => re.test(zh)).map(([, en]) => en))];
  if (hits.length > 0) return hits.join(" and ");
  return "the named inspection area";
}

function checkpointsFromCaption(text: string): string[] {
  const numbered: string[] = [];
  const numberedRe = /第[一二三四五六七八九十\d]+個看[：:]?\s*([^\n。；;]+)/g;
  for (const match of text.matchAll(numberedRe)) {
    const raw = (match[1] ?? "").trim();
    if (raw.length > 0) numbered.push(translateSpot(raw));
  }
  if (numbered.length >= 2) return numbered;

  if (!/[一二三四五六七八九十\d]+個位置|[一二三四五六七八九十\d]+個檢查/.test(text)) {
    return [];
  }

  const hits: Array<{ index: number; en: string }> = [];
  for (const [re, en] of SPOT_LEXICON) {
    const match = re.exec(text);
    if (match && match.index >= 0) hits.push({ index: match.index, en });
  }
  hits.sort((a, b) => a.index - b.index);
  const unique = [...new Set(hits.map((hit) => hit.en))];
  return unique.length >= 2 ? unique.slice(0, 3) : [];
}

export function carouselInspectionShots(caption: string, topic: string): string[] {
  const points = checkpointsFromCaption(`${caption}\n${topic}`);
  const defaults = [
    "Overall closer look at the complete passport item so fabric grain, seams and full silhouette stay readable.",
    "Tight close-up of the problem area named by the topic; the wear marks fill the frame.",
    "Same-counter after-treatment or before/after comparison of the identical physical item; do not introduce a second garment."
  ];
  if (points.length === 0) return defaults;
  const shots = points.slice(0, 3).map(
    (spot, index) =>
      `Close-up of checkpoint ${index + 1}: ${spot}. Keep the rest of the same item recognizable at the frame edge.`
  );
  while (shots.length < 3) {
    const next = defaults[shots.length];
    if (!next) break;
    shots.push(next);
  }
  return shots;
}

function pickupCarouselBriefs(topic: string): string[] {
  const cleaned = cleanTopic(topic);
  const headline = /床單|被套|棉被|床組|枕/.test(cleaned)
    ? "床組"
    : /童鞋/.test(cleaned)
      ? "童鞋"
      : /鞋/.test(cleaned) && /包/.test(cleaned)
        ? "鞋子與包包"
        : /鞋/.test(cleaned)
          ? "鞋子"
          : /襯衫/.test(cleaned) && /西裝/.test(cleaned)
            ? "襯衫與西裝"
            : /襯衫/.test(cleaned)
              ? "襯衫"
              : /牛仔/.test(cleaned)
                ? "牛仔褲"
                : /娃娃|玩偶/.test(cleaned)
                  ? "娃娃"
                  : /包/.test(cleaned)
                    ? "包包"
                    : "衣物";
  const shoeColour = shoeSubjectFor(cleaned);
  const subject =
    headline === "鞋子"
      ? `exactly one paired set of two ${shoeColour}`
      : headline === "床組"
        ? "exactly one complete folded warm-white cotton duvet cover with a thin navy piping edge"
        : `exactly one complete ${headline} item`;
  const sameSubject =
    headline === "鞋子"
      ? `the same paired set of two ${shoeColour}`
      : headline === "床組"
        ? "the same folded duvet cover"
        : `the same complete ${headline} item`;
  return [
    `Present ${cleaned} with ${subject} on the locked inspection counter beside one low-profile blue woven polypropylene laundry bag. Show both complete bag handles and all four attachment points; the bag is open and not overfilled.`,
    `Show ${sameSubject} and the same blue woven bag. One complete adult hand gently lifts only a corner to reveal the care label. Preserve five fingers, seams, piping, both bag handles and original condition.`,
    `Show ${sameSubject} neatly separated beside the same open blue woven bag instead of being forced inside. The counter fully supports both objects; preserve realistic fabric volume, both complete handles and four attachment points.`,
    `Show one phone photographing ${sameSubject}, the care label and the same complete blue woven bag on the counter. The phone screen may show the camera view but must contain no readable interface text.`
  ];
}

const WHITE_SHIRT_7_20_BRIEFS = [
  "Show one complete white shirt laid naturally on the locked inspection counter, with the collar and both underarm areas visible. Preserve the whole shirt and do not imply a cleaning result.",
  "Show a close inspection of the same shirt's collar edge and one underarm area, with one complete adult hand pointing gently without covering the fabric. Preserve five fingers and the original yellowing.",
  "Show the same shirt lying flat beside one clean dry towel while one stiff brush is clearly placed aside and not touching the fabric. No warning icon and no cleaning action.",
  "Show one phone camera framing the same full shirt while the collar detail and care label remain visible on the counter. The phone screen may show the camera view but must contain no readable interface text."
];

export function buildCarouselImagePrompts(input: CarouselPromptInput): string[] {
  const passport = garmentPassportFromTopic(input.topic);
  const dayIndex = Number(input.date.replace(/-/g, "")) % BACKGROUND_ANCHORS.length;
  const shared =
    `${passport} ${CAROUSEL_SCENE_LOCK} Create one portrait 4:5 photo. ` +
    "Keep the exact featured object consistent across all four photos. " +
    phoneRealism(dayIndex) +
    " No poster layout, no graphic panel, no address, no phone number.";

  const briefs =
    input.date === "2026-07-20" && (input.slot ?? 1) === 1
      ? WHITE_SHIRT_7_20_BRIEFS
      : (input.seo_sync_page ?? "").includes("taichung-citywide-laundry-pickup")
        ? pickupCarouselBriefs(input.topic)
        : [
            `Hero still of ${topicBody(input.topic)} through the passport item as the main close-up on the locked inspection counter. Keep the entire object readable and do not imply a cleaning result.`,
            ...carouselInspectionShots(input.caption ?? "", input.topic)
          ];

  return briefs.map((brief, index) => {
    const slide = index + 1;
    const sameGarment = slide === 1 ? "" : ` ${SAME_GARMENT_CONTINUITY}.`;
    return `${shared} Photo ${slide} of 4.${sameGarment} ${brief}`;
  });
}

function carouselCaptionSource(slot: GrowthPlaybookSlot): string {
  if (slot.facebook_caption || slot.instagram_caption || slot.caption) {
    return [slot.facebook_caption, slot.instagram_caption, slot.caption, slot.topic, slot.hook]
      .filter((part): part is string => Boolean(part))
      .join("\n");
  }
  try {
    return `${slot.topic}\n${slot.hook}\n${captionFromPlaybook(slot, "facebook")}`;
  } catch {
    return `${slot.topic}\n${slot.hook}`;
  }
}

function carouselPromptsFromPlaybook(slot: GrowthPlaybookSlot): string[] {
  return buildCarouselImagePrompts({
    date: slot.date,
    slot: slot.slot,
    topic: slot.topic,
    caption: carouselCaptionSource(slot),
    seo_sync_page: slot.seo_sync_page
  });
}

function carouselItemsFromPlaybook(slot: GrowthPlaybookSlot, config: AppConfig): CarouselItem[] | undefined {
  if (slot.format !== "carousel-guide" && slot.date < COMPANION_MEDIA_START_DATE) return undefined;
  return carouselPromptsFromPlaybook(slot).map((prompt, index) => {
    const slide = index + 1;
    return {
      slide,
      image_prompt: prompt,
      local_image_path: relativeCarouselAssetPath(slot.date, slot.slot, slide),
      public_image_url: config.publicImageBaseUrl
        ? buildGitHubPagesCarouselImageUrl(config.publicImageBaseUrl, slot.date, slot.slot, slide)
        : ""
    };
  });
}

function videoPromptFromPlaybook(slot: GrowthPlaybookSlot): string | undefined {
  if (slot.video_candidate) {
    return withVideoItemProfilePrompt(slot.video_candidate.grok_motion_prompt, slot.topic);
  }
  if (slot.format !== "reel") return undefined;
  if (slot.video_prompt) return slot.video_prompt;

  const topic = cleanTopic(slot.topic);
  // Written around what this class of model actually does well. Detailed finger
  // work (scrubbing, flipping a collar) deforms, and a stain changing to clean
  // inside one shot is not held consistently, so this asks for one object, one
  // slow move, and a person implied at the edge of frame rather than rendered.
  // Trust matters for laundry, so the shot cannot be a cold product turntable
  // either: an arm or a tool entering frame carries "someone is working here"
  // without asking the model to draw a hand in close-up.
  return withVideoItemProfilePrompt(
    `Vertical 9:16 smartphone video, filmed handheld on a phone by staff inside an ordinary Taiwanese laundry shop, one continuous shot of 8 to 10 seconds. Subject: ${topic}. Hold on the exact item with one slow gentle push-in and slight natural camera shake. A forearm, or a tool such as a spray bottle, brush or hanger, may enter from the edge of frame to suggest someone working, but keep hands out of close-up and never show finger detail. Lighting: soft fluorescent ceiling light mixed with cool window daylight from the left, roughly 4500K, consistent shadow direction and exposure throughout. Realistic fabric texture with slight wrinkles, ordinary shop surroundings, near-silent with only faint room tone. One dominant action only. No scrubbing or folding, no stain changing to clean within the shot, no cut to a second setup, no cinematic look, no studio lighting, no gimbal or drone move, no colour grade, no on-screen text, no logos, no watermark.`,
    topic
  );
}

function assertPlaybookCaptionQuality(slot: GrowthPlaybookSlot, caption: string): void {
  const paragraphs = caption.split("\n\n");
  const forbidden = ["畫面維持", "這支內容會用", "短影音題", "轉詢問題", "9:16", "主視覺", "route", "SEO"];
  // Block 2 is the last line most readers see before Instagram folds the
  // caption, so it may not be spent on the shop name that is already the
  // account handle above it. The name still has to appear, in the follow line.
  if (paragraphs[1] === brandLine) {
    throw new Error(
      `Invalid playbook caption for ${slot.date} slot ${slot.slot}: block 2 is the fold line and must not be the bare brand name.`
    );
  }
  if (!caption.includes(brandLine)) {
    throw new Error(`Invalid playbook caption for ${slot.date} slot ${slot.slot}: missing brand name.`);
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
  const facebookCaption = captionFromPlaybook(slot, "facebook");
  const instagramCaption = captionFromPlaybook(slot, "instagram");
  const isReel = slot.format === "reel";
  const carouselItems = carouselItemsFromPlaybook(slot, config);
  const videoPrompt = videoPromptFromPlaybook(slot);
  const videoCandidate = slot.video_candidate
    ? { ...slot.video_candidate, grok_motion_prompt: videoPrompt ?? slot.video_candidate.grok_motion_prompt }
    : undefined;
  const mediaType = slot.media_package
    ? "mixed-carousel"
    : carouselItems
      ? "carousel"
      : isReel
        ? "reel"
        : "image";
  assertPlaybookCaptionQuality(slot, facebookCaption);
  assertPlaybookCaptionQuality(slot, instagramCaption);
  return {
    slot: slot.slot,
    time: slot.time,
    category: slot.slot === 1 ? "知識文" : "情境文",
    topic: slot.topic,
    format: slot.format,
    media_type: mediaType,
    instagram_caption: instagramCaption,
    facebook_caption: facebookCaption,
    image_prompt: carouselItems?.[0]?.image_prompt ?? imagePromptFromPlaybook(slot),
    carousel_items: carouselItems,
    video_prompt: videoPrompt,
    video_candidate: videoCandidate,
    media_package: slot.media_package,
    visual_route: slot.visual_route,
    traffic_route: slot.traffic_route,
    content_role: slot.content_role,
    views_target: slot.views_target,
    follower_target: slot.follower_target,
    follow_cta: slot.follow_cta,
    seo_sync_page: slot.seo_sync_page,
    search_intent: slot.search_intent,
    target_queries: slot.target_queries,
    evidence_type: slot.evidence_type,
    ten_day_review_metric: slot.ten_day_review_metric,
    content_plan_source: "growth-playbook",
    local_image_path: carouselItems?.[0]?.local_image_path ?? relativeAssetPath(slot.date, slot.slot),
    public_image_url:
      carouselItems?.[0]?.public_image_url ??
      (config.publicImageBaseUrl ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, slot.date, slot.slot) : ""),
    local_video_path:
      slot.video_candidate || isReel ? relativeVideoAssetPath(slot.date, slot.slot) : undefined,
    public_video_url:
      (slot.video_candidate || isReel) && config.publicImageBaseUrl
        ? buildGitHubPagesVideoUrl(config.publicImageBaseUrl, slot.date, slot.slot)
        : undefined,
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
    media_type: "image",
    instagram_caption: caption,
    facebook_caption: caption,
    image_prompt: template.imagePrompt,
    visual_route: template.visualRoute,
    traffic_route: template.trafficRoute,
    content_role: schedule.slot === 1 ? "reach-answer" : "evidence-conversion",
    content_plan_source: "legacy-template",
    local_image_path: relativeAssetPath(date, schedule.slot),
    public_image_url: config.publicImageBaseUrl
      ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, schedule.slot)
      : "",
    status: "pending"
  };
}

export interface BuildDailyContentOptions {
  root?: string;
  abPlan?: AbDayPlan[];
}

export function buildDailyContent(
  date: string,
  config: AppConfig,
  options: BuildDailyContentOptions = {}
): StampedDailyContent {
  const root = projectRoot(options.root);
  const abPlan = options.abPlan ?? loadAbTestPlanSync(root);
  const dayPlan = planForDate(abPlan, date);
  const eveningPaused = Boolean(dayPlan?.evening?.paused) && planSlot(dayPlan, 2) === undefined;
  const occupiedTopics = eveningPaused
    ? recentCalendarTopics(date, TOPIC_REPEAT_WINDOW_DAYS, root)
    : [];

  const playbookSlots = playbookSlotsForDate(date);
  const slots: DailySlot[] = DAILY_SCHEDULE.map((schedule) => {
    const playbookSlot = playbookSlots?.find((slot) => slot.slot === schedule.slot);
    if (schedule.slot === 2 && eveningPaused && playbookSlot) {
      const slot1Topic = playbookSlots?.find((slot) => slot.slot === 1)?.topic;
      const resolved = playbookSlotForPausedEvening(
        playbookSlot,
        slot1Topic ? [slot1Topic, ...occupiedTopics] : occupiedTopics
      );
      return dailySlotFromPlaybook(resolved, config);
    }
    if (schedule.slot === 2 && eveningPaused && !playbookSlot) {
      return dailySlotFromTemplate(date, schedule, config);
    }
    return playbookSlot ? dailySlotFromPlaybook(playbookSlot, config) : dailySlotFromTemplate(date, schedule, config);
  });

  return stampDailyContentWrite({
    date,
    timezone: config.timezone,
    generated_at: new Date().toISOString(),
    slots
  });
}

/** Identity writeDailyContent stamps. External Codex patches do not know this string. */
export const CALENDAR_WRITTEN_BY = "contentPlan.writeDailyContent";

export type StampedDailyContent = DailyContent & {
  written_by?: string;
  content_checksum?: string;
  tampered?: boolean;
};

export interface CalendarIntegrity {
  tampered: boolean;
  legacy: boolean;
  shouldRebuild: boolean;
  reasons: string[];
}

function normalizeForChecksum(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForChecksum);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      normalized[key] = normalizeForChecksum(record[key]);
    }
    return normalized;
  }
  return value;
}

export function calendarSlotsChecksum(slots: DailySlot[]): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeForChecksum(slots)))
    .digest("hex")
    .slice(0, 16);
}

export function taipeiCalendarDate(now = new Date()): string {
  return getZonedDateParts(now, "Asia/Taipei").date;
}

export function stampDailyContentWrite(content: DailyContent): StampedDailyContent {
  const stamped = content as StampedDailyContent;
  const rest = {
    date: stamped.date,
    timezone: stamped.timezone,
    generated_at: stamped.generated_at,
    slots: stamped.slots
  };
  return {
    ...rest,
    written_by: CALENDAR_WRITTEN_BY,
    content_checksum: calendarSlotsChecksum(rest.slots)
  };
}

/**
 * Missing stamps on dates before today are legacy (no alarm).
 * Today or a future date with a missing stamp, wrong writer, or bad checksum
 * is tampered. A past file that claims a stamp and fails it is also tampered,
 * but only today/future dates rebuild.
 */
export function inspectDailyContentIntegrity(
  content: DailyContent,
  options: { today?: string } = {}
): CalendarIntegrity {
  const today = options.today ?? taipeiCalendarDate();
  const actionable = content.date >= today;
  const stamped = content as StampedDailyContent;
  const writtenBy = typeof stamped.written_by === "string" ? stamped.written_by : "";
  const checksum = typeof stamped.content_checksum === "string" ? stamped.content_checksum : "";
  const expected = Array.isArray(content.slots) ? calendarSlotsChecksum(content.slots) : "";
  const missingWriter = writtenBy.length === 0;
  const missingChecksum = checksum.length === 0;
  const mismatch = !missingChecksum && checksum !== expected;
  const wrongWriter = !missingWriter && writtenBy !== CALENDAR_WRITTEN_BY;

  if ((missingWriter || missingChecksum) && !actionable && !mismatch && !wrongWriter) {
    return { tampered: false, legacy: true, shouldRebuild: false, reasons: [] };
  }

  const reasons: string[] = [];
  if (missingWriter) reasons.push("missing written_by");
  if (missingChecksum) reasons.push("missing content_checksum");
  if (mismatch) reasons.push("content_checksum mismatch");
  if (wrongWriter) reasons.push(`written_by is not ${CALENDAR_WRITTEN_BY}`);

  const tampered = reasons.length > 0;
  return {
    tampered,
    legacy: false,
    shouldRebuild: tampered && actionable,
    reasons
  };
}

export function shouldRebuildTamperedCalendar(
  content: DailyContent,
  options: { today?: string } = {}
): boolean {
  return inspectDailyContentIntegrity(content, options).shouldRebuild;
}
