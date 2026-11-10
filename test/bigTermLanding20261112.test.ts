import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-10 行銷裁定 M1–M7 後的大詞修正包。改前聯絡與 schema 次數凍結在 BASELINE。 */
const TODAY = "2026-11-10";
const COMP = "確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償。";
const DAMAGE = "/guides/laundry-damage-risk.html#damage-compensation";
const SHOE_ANCHOR = "台中洗鞋推薦怎麼挑";
const LAUNDRY_ANCHOR = "台中洗衣推薦怎麼挑";
const SHOE_HREF = "https://sixiangjialaundry.com/guides/taichung-shoe-cleaning-how-to-choose.html";
const LAUNDRY_HREF = "https://sixiangjialaundry.com/guides/taichung-laundry-service-search.html";
const P2 = "guides/taichung-shoe-cleaning-how-to-choose.html";
const P3 = "guides/taichung-laundry-service-search.html";
const P6B_SENTENCE =
  '想比較台中洗鞋店怎麼挑，見<a href="https://sixiangjialaundry.com/guides/taichung-shoe-cleaning-how-to-choose.html">台中洗鞋推薦怎麼挑</a>；價目與收送見<a href="https://sixiangjialaundry.com/services/shoe-bag-care.html">台中洗鞋店</a>。';
const P6B = [
  "hubs/shoe-care.html",
  "guides/suede-shoe-cleaning.html",
  "guides/nubuck-shoe-cleaning.html",
  "guides/white-shoe-yellowing.html",
  "guides/leather-sneaker-care.html",
  "guides/hiking-shoe-cleaning.html",
  "guides/washing-machine-shoe-risk.html",
  "guides/satin-shoe-cleaning.html"
] as const;
const C1A =
  "私享家洗衣店位於台中市西屯區青海路二段365號（至善國中對面），做鞋子、包包與衣物清潔。鞋子先分材質再報價，一般運動鞋 $250、麂皮鞋 $400（水洗參考價，看過實品再報價）；台中全市免費收送、沒有最低消費；確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償；洗鞋一般約一個禮拜可以拿。LINE 官方 @454foyks，或 LINE 0968327653。";
const C1B =
  "私享家洗衣店位於台中市西屯區青海路二段365號（至善國中對面），有實體門市，週一至週五 10:00–20:00、週六 12:00–18:00、週日公休。衣物先看洗標與材質再報價，襯衫 $70、厚外套 $180、羽絨外套 $280、長大衣 $300（水洗參考價，乾洗另計，看過實品再報價）；台中全市免費收送、沒有最低消費；確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償；一般約 7 天可以拿，實際日期收件時確認。改衣 60 元起，實際價格現場由師傅報價。LINE 官方 @454foyks，或 LINE 0968327653。";
const YELLOW = "會先講。不保證變全新；鞋底膠邊發黃洗不掉，可以改用上色覆蓋處理，看過實品再說明。";
const M6 =
  "公開。襯衫 $70、長褲 $70、厚外套 $180、羽絨外套 $280、長大衣 $300，皆為水洗參考價，乾洗另計。參考價，看過實品再報價。改衣 60 元起，實際價格現場由師傅報價。見";
const LINE = "LINE 官方 @454foyks，或 LINE 0968327653。";

const PAGES = [
  {
    path: "services/shoe-bag-care.html",
    title: "台中洗鞋店｜運動鞋 $250、麂皮鞋 $400、免費收送｜私享家洗衣店（西屯）",
    description:
      "台中洗鞋店私享家在西屯青海路二段365號（至善國中對面），鞋子先分材質再報價：一般運動鞋 $250、麂皮鞋 $400（水洗參考價），洗鞋一般約一個禮拜可以拿。參考價，看過實品再報價。台中全市免費收送、沒有最低消費。" +
      LINE,
    h1: "台中洗鞋店，先分材質再報價。",
    h1Html: "台中洗鞋店，<br>先分材質再報價。"
  },
  {
    path: P2,
    title: "台中洗鞋推薦怎麼挑？7 個檢查點與參考價對照｜私享家洗衣店（西屯）",
    description:
      "台中洗鞋推薦怎麼挑？先看有沒有分材質、價格公開、洗壞怎麼賠、多久可以拿、收送有沒有最低消費、做不到的會不會先講。私享家：運動鞋 $250、麂皮鞋 $400（水洗參考價），參考價，看過實品再報價；台中全市免費收送、沒有最低消費。" +
      LINE,
    h1: "台中洗鞋推薦怎麼挑：先問這 7 件事"
  },
  {
    path: P3,
    title: "台中洗衣推薦怎麼挑？收送、價目、洗壞怎麼賠先問清楚｜私享家洗衣店（西屯）",
    description:
      "台中洗衣推薦怎麼挑？先問收送有沒有最低消費、價目公開嗎、洗壞怎麼賠、多久可以拿、做不到的會不會先講。私享家：台中全市免費收送、沒有最低消費；襯衫 $70、長大衣 $300（水洗參考價，乾洗另計），參考價，看過實品再報價；一般約 7 天可以拿，實際日期收件時確認。" +
      LINE,
    h1: "台中洗衣推薦怎麼挑：先問這 7 件事"
  },
  {
    path: "services/taichung-xitun-laundry.html",
    title: "台中西屯洗衣店在哪？逢甲青海路門市、至善國中對面｜免費收送、沒有最低消費｜私享家",
    description:
      "尋找台中西屯或逢甲洗衣店？私享家門市位於青海路二段365號（至善國中對面）。判斷衣物乾水洗、鞋包材質與白鞋泛黃，免費收送、沒有最低消費。" +
      LINE,
    h1: "台中西屯洗衣店在哪？"
  },
  {
    path: "local/qinghai-road-shoe-cleaning.html",
    title: "西屯洗鞋、青海路洗鞋｜水洗參考價：運動鞋 $250 起、麂皮鞋 $400｜免費收送｜私享家洗衣店",
    description:
      "找西屯洗鞋或青海路洗鞋，門市就在西屯青海路二段365號（至善國中對面）。先分鞋面材質再洗，不保證變全新。可到店，也可約免費收送、沒有最低消費。",
    h1: "西屯洗鞋、青海路洗鞋：門市在青海路二段365號"
  }
] as const;

const COMP_PLUS = new Set([
  "services/shoe-bag-care.html",
  P2,
  P3,
  "services/taichung-xitun-laundry.html",
  "services/taichung-citywide-laundry-pickup.html",
  "services/taichung-laundry-price-list.html"
]);
const HREF_PLUS = new Set([
  P2,
  P3,
  "services/taichung-xitun-laundry.html",
  "services/taichung-citywide-laundry-pickup.html",
  "services/taichung-laundry-price-list.html"
]);

const BASELINE = {
  "about/sixiangjia-taichung-only.html": { line: 13, phone: 13, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/athletic-shoe-mixed-materials.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/backpack-cleaning-check.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-base-stud-check.html": { line: 5, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-clasp-stuck-check.html": { line: 11, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-clean-vs-repair.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-cleaning-price.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/bag-color-transfer.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-edge-paint-cracking.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-frame-gap.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-handle-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-hardware-tarnish.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-ink-marks.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-lining-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-structure-collapse.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bag-zipper-tape-fray.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bedding-duvet-cleaning.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bedding-duvet-mold.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/bedding-storage-check.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/birkenstock-care.html": { line: 9, phone: 7, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/blanket-damp-check.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/blanket-vs-duvet.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/blanket-washing.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/boot-shaft-cleaning.html": { line: 3, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/canvas-bag-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/canvas-shoe-mud.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/cardigan-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/care-label-symbols-text-guide.html": { line: 6, phone: 1, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/carpet-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/cashmere-knit-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/casual-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/clear-sole-yellowing.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/clothing-alteration-with-laundry.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/clothing-color-fading.html": { line: 4, phone: 4, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/clothing-dye-transfer.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/clothing-ink-stain.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/clothing-mold-airing.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/coat-cuff-wear.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/coated-canvas-bag-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/coin-laundry-vs-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/collar-sweat-yellow.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/crossbody-bag-strap.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/curtain-cleaning.html": { line: 14, phone: 12, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/day-dress-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/denim-jeans-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/doll-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/down-clump-after-wash.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/down-duvet-washing.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/down-jacket-cleaning.html": { line: 6, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/down-jacket-feather-leak.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/down-vest-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/dress-shirt-starch-risk.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/dress-shoe-polish-buildup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/dry-cleaning-explained.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/dry-cleaning-guide.html": { line: 4, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/dry-cleaning-shrink-risk.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/faux-fur-collar-cleaning.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/fleece-jacket-pilling.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/garment-lining-detach.html": { line: 5, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/golf-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/gore-tex-jacket-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/hat-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/high-heel-structure.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/hiking-shoe-cleaning.html": { line: 3, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/how-laundry-quote-works.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/insulated-down-pants-care.html": { line: 5, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/iron-scorch-mark.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/jacket-cleaning-price.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/kids-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/knit-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/knit-shoulder-bump-stretch.html": { line: 4, phone: 4, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/knit-snag-check.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/lambskin-bag-care.html": { line: 7, phone: 7, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/laundry-damage-risk.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 1, href: 0 },
  "guides/laundry-partner-showcase.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-bag-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-bag-crease-lighten.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-belt-care.html": { line: 7, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-glove-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-jacket-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-jacket-elbow-crease.html": { line: 9, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-mold-treatment.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 1 },
  "guides/leather-pants-skirt.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-shoe-cleaning-price.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/leather-shoe-salt-bloom.html": { line: 5, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-shoe-water-marks.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-sneaker-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/leather-vest-cleaning.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/light-leather-bag-yellowing.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/linen-garment-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/luggage-wheel-cleaning.html": { line: 7, phone: 7, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/luxury-bag-mold.html": { line: 4, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/luxury-bag-storage.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/luxury-designer-shoe-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/luxury-down-jacket-cleaning.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/luxury-dry-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/makeup-on-bag-lining.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/mattress-protector-washing.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/mesh-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/new-shoe-dye-ruboff.html": { line: 10, phone: 5, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/nubuck-shoe-cleaning.html": { line: 3, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/nylon-bag-care.html": { line: 6, phone: 6, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/oil-vs-water-stain-choice.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/patent-leather-shoe-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/pet-hair-on-coat.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/photo-before-laundry.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/pleated-skirt-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/plush-doll-cleaning.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/post-wash-drying-before-storage.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/prewash-self-check.html": { line: 7, phone: 1, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/pu-leather-peeling.html": { line: 13, phone: 5, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 1 },
  "guides/rainy-bag-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/rainy-shoe-care.html": { line: 4, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/rubber-rain-boot-care.html": { line: 7, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/sandal-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/satin-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/scarf-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/school-uniform-care.html": { line: 2, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/sheepskin-boot-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/sherpa-teddy-fleece-jacket.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/shirt-suit-dry-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-collar-foam-check.html": { line: 11, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-counter-lining-wear.html": { line: 12, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-drying-heat-risk.html": { line: 6, phone: 6, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-heel-counter-collapse.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-insole-check.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-insole-machine-wash.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/shoe-lace-eyelet-check.html": { line: 11, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-mold-surface-check.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-odor-source.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-outsole-tread-wear.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-sole-separation-limit.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-toe-cap-wear.html": { line: 11, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-waterproof-treatment.html": { line: 10, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/shoe-welt-stitch-break.html": { line: 16, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/silk-garment-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/ski-snow-jacket-cleaning.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/sleeping-bag-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/spot-test-before-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/sticky-bag-lining.html": { line: 7, phone: 6, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/straw-bag-care.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/suede-bag-care.html": { line: 6, phone: 5, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/suede-jacket-cleaning.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/suede-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/suit-pants-crease.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/suit-water-wash-risk.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/summer-quilt-washing.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/sweater-cleaning-price.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/sweater-shrunk-what-now.html": { line: 4, phone: 4, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/synthetic-vs-leather-handle.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/taichung-laundry-service-search.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/taichung-shoe-cleaning-how-to-choose.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/trench-coat-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/vachetta-leather-darkening.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/vacuum-bag-storage-risk.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/velvet-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/wallet-cleaning-check.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/washing-machine-shoe-risk.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 1 },
  "guides/waterproof-breathable-shoe-care.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/white-shoe-yellowing.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/wool-coat-dry-clean.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/wool-duvet-washing.html": { line: 3, phone: 3, faq: 0, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "guides/wool-knit-shrink-risk.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/wool-sweater-pilling.html": { line: 7, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "guides/xitun-laundry-how-to-choose.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "hubs/bag-care.html": { line: 1, phone: 2, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "hubs/bedding-textile-care.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "hubs/commercial-laundry.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "hubs/local-pickup.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "hubs/luxury-garment-care.html": { line: 1, phone: 2, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "hubs/shoe-care.html": { line: 4, phone: 3, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "knowledge/index.html": { line: 5, phone: 3, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "local/beitun-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/beitun-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/central-district-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/dadu-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/dali-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/daya-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/donghai-laundry-pickup.html": { line: 6, phone: 6, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 1 },
  "local/east-district-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/fengjia-laundry-pickup.html": { line: 10, phone: 10, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/fengjia-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/fengyuan-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/houli-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/nantun-laundry-pickup.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/nantun-shoe-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/north-district-laundry-pickup.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 1 },
  "local/qinghai-road-shoe-cleaning.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 1 },
  "local/qingshui-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/shalu-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/shengang-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/south-district-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/taiping-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/tanzi-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/west-district-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/wufeng-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/wuqi-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/wuri-laundry-pickup.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "local/zhongke-office-laundry.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/clinic-uniform-laundry.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/curtain-carpet-cleaning.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/down-jacket-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/duvet-bedding-cleaning.html": { line: 7, phone: 5, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/evening-gown-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/fabric-storage.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/ironing-pressing.html": { line: 6, phone: 5, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/luggage-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/luxury-bag-cleaning.html": { line: 4, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/office-shirt-subscription.html": { line: 4, phone: 1, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/plush-doll-cleaning.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/postpartum-center-laundry.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/secondhand-luxury-shop-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/sequin-rhinestone-clothing-cleaning.html": { line: 2, phone: 2, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/shoe-bag-care.html": { line: 14, phone: 7, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 1, href: 1 },
  "services/suit-dry-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/taichung-citywide-laundry-pickup.html": { line: 18, phone: 9, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/taichung-laundry-price-list.html": { line: 13, phone: 6, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/taichung-xitun-laundry.html": { line: 4, phone: 4, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/uniform-laundry.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 },
  "services/white-shoe-cleaning.html": { line: 3, phone: 3, faq: 1, review: 0, agg: 0, howto: 0, video: 0, comp: 0, href: 0 },
  "services/wool-coat-cleaning.html": { line: 7, phone: 7, faq: 1, review: 0, agg: 0, howto: 1, video: 0, comp: 0, href: 0 }
} as const;

type BaselineKey = keyof typeof BASELINE;

function root(): string {
  return repoRootFromHere();
}

function read(rel: string): string {
  return readFileSync(join(root(), "seo-overrides", rel), "utf8");
}

function meta(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1] ?? "";
}

function webPage(html: string): { name?: string; description?: string; dateModified?: string } {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}";
  const graph = (JSON.parse(raw) as { "@graph"?: Array<Record<string, string>> })["@graph"];
  return graph?.find((node) => node["@type"] === "WebPage") ?? {};
}

function h1Text(html: string): string {
  return meta(html, /<h1[^>]*>([\s\S]*?)<\/h1>/u).replace(/<br\s*\/?>/gu, "");
}

function countType(html: string, type: string): number {
  return html.split(`"@type":"${type}"`).length - 1;
}

function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function dealRow(html: string): string {
  const h3 = '<h3 style="margin-top: 22px;">成交連結</h3>';
  const at = html.indexOf(h3);
  const after = html.slice(at + h3.length);
  const open = after.match(/\n[ \t]*<div class="link-row"(?: data-money-pages)?>/u);
  if (!open || open.index === undefined) return "";
  const openAt = at + h3.length + open.index;
  const openEnd = html.indexOf(">", openAt) + 1;
  const closeAt = html.indexOf("</div>", openEnd);
  return html.slice(openEnd, closeAt);
}

function anchorCount(html: string, href: string, text: string): number {
  return html.split(`<a href="${href}">${text}</a>`).length - 1;
}

function tbodyRows(html: string, id: string): number {
  const section = html.split(`id="${id}"`)[1] ?? "";
  const table = section.split("</table>")[0] ?? "";
  const body = table.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
  return body.split("<tr>").length - 1;
}

function stripAllowed(text: string): string {
  return text.replaceAll("不保證變全新", "").replaceAll("要變回全新：不保證", "");
}

describe("2026-11-10 大詞修正包核定句", () => {
  it("seo-overrides HTML 檔數與改前相同", () => {
    expect(htmlFiles(join(root(), "seo-overrides"))).toHaveLength(258); // 234 + 11/11 發霉問句 8 頁 + 第二批 11 頁 + 價格與報價 5 頁
  });

  for (const page of PAGES) {
    it(`${page.path} 的 title 四欄同句`, () => {
      const html = read(page.path);
      const pageNode = webPage(html);
      expect(meta(html, /<title>([^<]*)<\/title>/u)).toBe(page.title);
      expect(meta(html, /<meta property="og:title" content="([^"]*)"/u)).toBe(page.title);
      expect(meta(html, /<meta name="twitter:title" content="([^"]*)"/u)).toBe(page.title);
      expect(pageNode.name).toBe(page.title);
      expect(meta(html, /<meta name="description" content="([^"]*)"/u)).toBe(page.description);
      expect(meta(html, /<meta property="og:description" content="([^"]*)"/u)).toBe(page.description);
      expect(meta(html, /<meta name="twitter:description" content="([^"]*)"/u)).toBe(page.description);
      expect(pageNode.description).toBe(page.description);
      if ("h1" in page) expect(h1Text(html)).toBe(page.h1);
      if ("h1Html" in page) expect(html).toContain(page.h1Html);
    });
  }

  it("P1 六列、P2／P3 七列，以及 C1-a／C1-b 與裁定句", () => {
    const shoe = read("services/shoe-bag-care.html");
    const choose = read(P2);
    const laundry = read(P3);
    expect(tbodyRows(shoe, "shoe-shop-pick-h")).toBe(6);
    expect(tbodyRows(choose, "shoe-shop-checklist")).toBe(7);
    expect(tbodyRows(laundry, "laundry-shop-checklist")).toBe(7);
    expect(shoe).toContain("台中洗鞋店怎麼挑？先問這 6 件事");
    expect(shoe).toContain(YELLOW);
    expect(shoe).not.toContain("膠邊氧化只能淡化");
    expect(choose).toContain(C1A);
    expect(choose).toContain("只送一雙，也要先知道收送怎麼算。");
    expect(choose).toContain("膠邊發黃、鞋底開膠不是刷得回去的。");
    expect(choose).toContain(YELLOW);
    expect(choose).toContain("台中洗鞋推薦怎麼挑？先問 7 件事：");
    expect(choose).not.toContain("不用先看誰排第一，");
    expect(choose).not.toContain("不從品牌或網紅推薦開始，而");
    expect(choose).toContain("要很快拿：洗鞋一般約一個禮拜可以拿，趕時間請先 LINE 問。");
    expect(choose).toContain("要變回全新：不保證；已氧化、磨耗、掉色的位置只能說明可改善範圍。");
    expect(choose).toContain("鞋底開膠、鞋面脆化：屬修繕，不是清潔；可以先傳照片到 LINE 問。");
    expect(choose).not.toContain("要當天或隔天拿：");
    expect(laundry).toContain(C1B);
    expect(laundry).toContain(M6);
    expect(laundry).toContain("<h2>依物件和問題找服務</h2>");
    expect(laundry).toContain("先對意圖，再進對應頁");
    expect(choose).toContain(`<time datetime="${TODAY}">${TODAY}</time>`);
    expect(laundry).toContain(`<time datetime="${TODAY}">${TODAY}</time>`);
    expect(webPage(choose).dateModified).toBe(TODAY);
    expect(webPage(laundry).dateModified).toBe(TODAY);
    expect(webPage(shoe).dateModified).toBe("2026-10-22");
    expect(shoe).toContain("10/26–11/9");
    expect(choose).toContain(
      "台中洗鞋推薦怎麼挑？先問 7 件事：有沒有先分材質、價格公開嗎、洗壞怎麼賠、多久可以拿、收送要不要最低消費、做不到的會不會先講、能不能先傳照片。私享家洗衣店（台中西屯）的答案寫在下表。參考價，看過實品再報價。門市在西屯，東海只有收送。"
    );
    expect(choose).toContain(
      '想直接看價目與送洗流程，見<a href="https://sixiangjialaundry.com/services/shoe-bag-care.html">台中洗鞋店</a>。'
    );
    expect(laundry).toContain(
      "先用手上的物件和問題找服務，不必只搜尋店名。私享家把台中洗衣、洗鞋、洗包、床組棉被、襯衫西裝、娃娃、精品乾洗與收送分成可核對的服務與指南；每個答案都回到材質、位置、狀態與處理界線。"
    );
    expect(laundry).toContain(
      '想直接看門市與收件方式，見<a href="https://sixiangjialaundry.com/">台中洗衣店首頁</a>；西屯、逢甲一帶見<a href="https://sixiangjialaundry.com/guides/xitun-laundry-how-to-choose.html">西屯洗衣店怎麼選</a>。'
    );
    const xitun = read("services/taichung-xitun-laundry.html");
    const qinghai = read("local/qinghai-road-shoe-cleaning.html");
    const pickup = read("services/taichung-citywide-laundry-pickup.html");
    const prices = read("services/taichung-laundry-price-list.html");
    expect(webPage(xitun).dateModified).toBe("2026-10-07");
    expect(webPage(qinghai).dateModified).toBe("2026-10-15");
    expect(xitun).toContain(
      '洗鞋價目與材質見<a href="https://sixiangjialaundry.com/services/shoe-bag-care.html">台中洗鞋店</a>；挑店檢查表見<a href="https://sixiangjialaundry.com/guides/taichung-laundry-service-search.html">台中洗衣推薦怎麼挑</a>。'
    );
    expect(xitun).toContain(
      "私享家洗衣店在西屯區青海路二段365號（至善國中對面），逢甲、西屯一帶可到店，也可約免費收送；台中全市免費收送、沒有最低消費。門市市話 04-2452-7411，LINE 官方 @454foyks，或 LINE 0968327653。"
    );
    expect(xitun).toContain(
      `確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償。<a href="https://sixiangjialaundry.com${DAMAGE}">洗衣店洗壞了，怎麼處理？</a>`
    );
    expect(qinghai).toContain(
      '台中洗鞋價目與收送見<a href="https://sixiangjialaundry.com/services/shoe-bag-care.html">台中洗鞋店</a>；挑店檢查表見<a href="https://sixiangjialaundry.com/guides/taichung-shoe-cleaning-how-to-choose.html">台中洗鞋推薦怎麼挑</a>。'
    );
    expect(pickup).toContain(
      `確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償。<a href="${DAMAGE}">洗衣店洗壞了，怎麼處理？</a>衣物一般約 7 天可以拿，實際日期收件時確認。洗鞋一般約一個禮拜可以拿。`
    );
    expect(prices).toContain(
      `以門市看過物件後的實際報價為主。確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償。<a href="${DAMAGE}">洗衣店洗壞了，怎麼處理？</a>`
    );
  });

  it("賠償句與連結：P1 不減，P2、P3、P4、P7 各新增一次", () => {
    for (const rel of Object.keys(BASELINE) as BaselineKey[]) {
      const html = read(rel);
      const before = BASELINE[rel];
      const compPlus = COMP_PLUS.has(rel) ? 1 : 0;
      const hrefPlus = HREF_PLUS.has(rel) ? 1 : 0;
      expect(html.split(COMP).length - 1, rel).toBe(before.comp + compPlus);
      expect((html.match(/laundry-damage-risk\.html#damage-compensation/g) || []).length, rel).toBe(
        before.href + hrefPlus
      );
      if (compPlus === 1) expect(html, rel).toContain(DAMAGE);
    }
  });

  it("P6a 頁尾兩個連結恰好各一次，P2、P3 不自連", () => {
    const deals = (Object.keys(BASELINE) as BaselineKey[]).filter((rel) => read(rel).includes("成交連結"));
    expect(deals).toHaveLength(218);
    for (const rel of deals) {
      const row = dealRow(read(rel));
      const shoe = anchorCount(row, SHOE_HREF, SHOE_ANCHOR);
      const laundry = anchorCount(row, LAUNDRY_HREF, LAUNDRY_ANCHOR);
      expect(shoe, rel).toBe(rel === P2 ? 0 : 1);
      expect(laundry, rel).toBe(rel === P3 ? 0 : 1);
    }
  });

  it("P6b 八頁各有內文一句", () => {
    for (const rel of P6B) {
      expect(read(rel).split(P6B_SENTENCE).length - 1, rel).toBe(1);
    }
  });

  it("被改頁的 LINE、電話與既有 schema 次數不低於改前，也不新增評分或教學 schema", () => {
    for (const rel of Object.keys(BASELINE) as BaselineKey[]) {
      const html = read(rel);
      const before = BASELINE[rel];
      expect(html.split("@454foyks").length - 1, rel).toBeGreaterThanOrEqual(before.line);
      expect(html.split("0968327653").length - 1, rel).toBeGreaterThanOrEqual(before.phone);
      expect(countType(html, "FAQPage"), rel).toBe(before.faq);
      expect(countType(html, "Review"), rel).toBe(before.review);
      expect(countType(html, "AggregateRating"), rel).toBe(before.agg);
      expect(countType(html, "HowTo"), rel).toBe(before.howto);
      expect(countType(html, "VideoObject"), rel).toBe(before.video);
      for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) {
        expect(() => JSON.parse(match[1] ?? ""), rel).not.toThrow();
      }
    }
  });

  it("新增核定句裡的保證與全新只出現在否定句，且沒有禁語", () => {
    const shoe = read("services/shoe-bag-care.html");
    const choose = read(P2);
    const laundry = read(P3);
    const fresh = [
      PAGES.map((page) => `${page.title}\n${page.description}`).join("\n"),
      shoe.slice(shoe.indexOf("shoe-shop-pick-h"), shoe.indexOf("六種鞋")),
      choose.slice(choose.indexOf('id="shoe-shop-checklist"'), choose.indexOf("先分材質，再看服務文案")),
      laundry.slice(laundry.indexOf('id="laundry-shop-checklist"'), laundry.indexOf('id="index-gap-rail"')),
      "洗鞋價目與材質見台中洗鞋店；挑店檢查表見台中洗衣推薦怎麼挑。",
      "私享家洗衣店在西屯區青海路二段365號（至善國中對面），逢甲、西屯一帶可到店，也可約免費收送；台中全市免費收送、沒有最低消費。門市市話 04-2452-7411，LINE 官方 @454foyks，或 LINE 0968327653。",
      "台中洗鞋價目與收送見台中洗鞋店；挑店檢查表見台中洗鞋推薦怎麼挑。",
      P6B_SENTENCE,
      "衣物一般約 7 天可以拿，實際日期收件時確認。洗鞋一般約一個禮拜可以拿。"
    ].join("\n");
    const stripped = stripAllowed(fresh);
    expect(stripped).not.toContain("保證");
    expect(stripped).not.toContain("全新");
    for (const word of ["如新", "除霉", "一口價", "防水", "最便宜", "最好", "第一名", "業界最高", "比法規"]) {
      expect(fresh, word).not.toContain(word);
    }
  });
});
