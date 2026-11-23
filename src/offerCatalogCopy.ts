/**
 * N19（2026-11-22）：#business 的 hasOfferCatalog 文案表。
 * 7 句是行銷經理 11/22 裁定的逐字文案；台中洗衣收送那格維持線上原文。
 * 只在這張表改目錄文案，不要動 answer_summary 或 area_served_name。
 * 由 generatePublicSite 的 buildBusinessSchema 使用；seo-overrides 裡嵌的同一份目錄要一起改（test/offerCatalogN19.test.ts 會比對）。
 */
export const OFFER_CATALOG_AREA_SERVED = { "@type": "AdministrativeArea", name: "台中市" } as const;
export const OFFER_CATALOG_COPY: Record<string, { description: string; offer?: { name: string; description: string } }> = {
  "shoe-bag-care": {
    description:
      "鞋子、包包先看材質再處理，可以先把鞋面、鞋底、鞋內或包身照片傳 LINE 問，會先說明清潔方式與可改善範圍。台中全市免費收送、沒有最低消費。"
  },
  "white-shoe-cleaning": {
    description: "白鞋不建議直接漂白或硬刷，會先看鞋面材質、膠邊、縫線、鞋墊與內裡，再判斷可以清潔到什麼程度。"
  },
  "fabric-storage": {
    description: "衣物、外套、寢具與厚棉布品收納前，先確認乾不乾、有沒有汗味、悶味、黃痕或局部髒污，再決定要不要先清潔。"
  },
  "taichung-xitun-laundry": {
    description:
      "台中西屯的門市在青海路二段365號，至善國中對面，週一至週五 10-20、週六 12-18、週日公休。衣物、鞋子、包包、白鞋與布品收納分開判斷：先看材質、痕跡位置與使用情境，再決定適合的做法。台中全市免費收送、沒有最低消費。"
  },
  "business-bulk-laundry": {
    description:
      "台中店家、公司或工作室有大量制服、工作衣、毛巾、床組或布品需要送洗，可先用 LINE 提供品項、數量與照片；台中全市免費收送、沒有最低消費，洗護費與處理方式另依實際物件判斷。"
  },
  "taichung-citywide-laundry-pickup": {
    description:
      "免費收送、沒有最低消費。不因件數少或金額未達標準而不收，也不限西屯一區。洗護費另計，依物件與實際狀況報價。門市在西屯區青海路二段365號；預約以 LINE 為主，先傳照片說明狀況再安排時間。",
    offer: {
      name: "台中洗衣收送",
      description: "免費收送、沒有最低消費；清潔與洗護費用另計。預約以 LINE 為主。"
    }
  },
  "taichung-laundry-price-list": {
    description: "台中洗衣、洗鞋、洗包參考價：襯衫 $70、一般運動鞋 $250、名牌包 $1500 起；乾洗、柔洗另計，看過實品再報價。"
  }
};
