export type VideoItemCategory = "clothing" | "shoes" | "bags" | "bedding" | "leather" | "mixed";

export interface VideoItemProfile {
  category: VideoItemCategory;
  version: "2026-08-05-v1";
  label: string;
  keywords: string[];
  visual_anchor: string;
  preferred_conflict: string;
  safe_action: string;
  forbidden_claims: string[];
  continuity_anchors: string[];
  primary_metric: "saves" | "shares" | "inquiries";
  prompt_directive: string;
}

const profiles: Record<VideoItemCategory, VideoItemProfile> = {
  clothing: {
    category: "clothing",
    version: "2026-08-05-v1",
    label: "衣物",
    keywords: ["衣", "襯衫", "外套", "西裝", "羽絨", "褲", "裙", "衣物", "運動衣"],
    visual_anchor: "領口、袖口、腋下、縫線、洗標與布料紋理",
    preferred_conflict: "衣物外觀看似乾淨，但接觸區或縫線位置藏著需要先判斷的狀態。",
    safe_action: "只翻開一個衣物部位或把一側衣袖平放，讓同一個細節完整露出。",
    forbidden_claims: ["完全去黃", "洗完變新", "百分之百去除", "保證不縮"],
    continuity_anchors: ["同一件衣物", "同一個洗標方向", "固定衣架或檢查台", "布料原始皺褶不改變"],
    primary_metric: "saves",
    prompt_directive:
      "衣物類：把領口、袖口、腋下或洗標做成唯一可見重點；只做一次翻面或平放動作，保留布料皺褶與原始狀態，不呈現洗後效果。"
  },
  shoes: {
    category: "shoes",
    version: "2026-08-05-v1",
    label: "鞋子",
    keywords: ["鞋", "球鞋", "白鞋", "皮鞋", "帆布鞋", "鞋墊", "鞋舌", "鞋口"],
    visual_anchor: "鞋口內裡、鞋舌、鞋墊邊、鞋底邊與膠合縫",
    preferred_conflict: "鞋面看起來沒有大問題，但鞋口、內裡或鞋底邊才是需要先看的位置。",
    safe_action: "只旋轉一隻鞋或只抬起一個鞋舌，另一隻鞋保持完全不動。",
    forbidden_claims: ["一定洗白", "完全去黃", "恢復全新", "膠邊不會脫"],
    continuity_anchors: ["固定左右鞋配對", "鞋帶與鞋舌完整", "鞋底接觸陰影", "一隻鞋一個動作"],
    primary_metric: "saves",
    prompt_directive:
      "鞋子類：以鞋口內裡、鞋舌、鞋墊邊或鞋底邊為唯一焦點；只旋轉一隻鞋或抬起一個鞋舌，另一隻鞋、鞋帶、鞋底與膠合縫保持不動，不呈現清潔結果。"
  },
  bags: {
    category: "bags",
    version: "2026-08-05-v1",
    label: "包包與行李箱",
    keywords: ["包", "提把", "包角", "包包", "化妝包", "行李箱", "健身包", "背包"],
    visual_anchor: "提把、包角、拉鍊邊、內袋縫線、五金與輪邊",
    preferred_conflict: "包包正面仍完整，但提把、包角、拉鍊邊或輪邊留下接觸與摩擦痕。",
    safe_action: "只移開一條提把、拉開一個內袋或把包包轉向一個角度，五金保持原位。",
    forbidden_claims: ["皮革恢復如新", "完全去除刮痕", "五金零損傷保證", "一定不變色"],
    continuity_anchors: ["同一個包包與提把", "拉鍊方向固定", "五金數量不變", "包角接觸面不穿模"],
    primary_metric: "inquiries",
    prompt_directive:
      "包包類：以提把、包角、拉鍊邊、內袋縫線或輪邊為唯一焦點；只移動一個部位讓細節露出，保留五金、縫線與原有磨耗，不暗示修復完成。"
  },
  bedding: {
    category: "bedding",
    version: "2026-08-05-v1",
    label: "床組與寢具",
    keywords: ["床組", "棉被", "被套", "床單", "枕", "寢具", "毯", "被"],
    visual_anchor: "縫線、填充厚度、表布、洗標、折疊層與受潮位置",
    preferred_conflict: "床組或棉被表面看似乾燥，但折疊層、縫線或填充狀態需要先確認。",
    safe_action: "只掀開一個角或拉開一層折疊，讓縫線與洗標一次可見，其他部分保持支撐。",
    forbidden_claims: ["完全除蟎", "百分之百除臭", "一定蓬回原狀", "保證沒有過敏原"],
    continuity_anchors: ["同一件床組", "完整支撐面", "折疊層數固定", "填充體積與縫線不漂移"],
    primary_metric: "shares",
    prompt_directive:
      "床組類：以縫線、填充厚度、表布、洗標或折疊層為唯一焦點；只掀開一個角或拉開一層，不讓大件物件漂浮、穿牆或瞬間改變蓬度。"
  },
  leather: {
    category: "leather",
    version: "2026-08-05-v1",
    label: "皮衣與皮革材質",
    keywords: ["皮衣", "皮革", "皮面", "皮質", "麂皮"],
    visual_anchor: "皮革粒面、摺痕、邊油、色差、五金與接觸陰影",
    preferred_conflict: "皮面的小色差或摺痕不一定是髒污，先判斷材質與磨耗比急著擦拭更重要。",
    safe_action: "只改變光線角度或指向一處摺痕，避免生成擦拭、上藥或顏色瞬間變化。",
    forbidden_claims: ["皮革恢復如新", "完全修復刮痕", "一定補回原色", "保證不掉色"],
    continuity_anchors: ["同一片皮面", "粒面方向固定", "五金位置固定", "摺痕與色差不可跳變"],
    primary_metric: "inquiries",
    prompt_directive:
      "皮革類：以粒面、摺痕、邊油、色差或五金為唯一焦點；只改變觀察角度或指向一處，不生成擦拭、上藥、補色或瞬間恢復效果。"
  },
  mixed: {
    category: "mixed",
    version: "2026-08-05-v1",
    label: "多物件情境",
    keywords: ["鞋包", "衣物與鞋", "襯衫、皮鞋、外套", "多件", "一起送洗"],
    visual_anchor: "分袋、分件、全貌與洗標照片，不把多個物件當成同一個清潔主體",
    preferred_conflict: "多個物件一起送洗時，最容易漏拍、混件或看不清各自的狀態。",
    safe_action: "只把一件物件移到自己的拍攝位置，其他物件保持分開並完全不動。",
    forbidden_claims: ["全部一起洗", "每件都能處理", "一次完全恢復", "混洗沒有風險"],
    continuity_anchors: ["每件物件分區", "件數固定", "分袋方向固定", "不把不同材質疊成一個主體"],
    primary_metric: "inquiries",
    prompt_directive:
      "多物件情境：不得把多種物件混成一個清潔主體；只展示分件、分袋或補拍其中一件的單一動作，明確保留件數與材質差異，不宣稱全部可處理。"
  }
};

export function inferVideoItemCategory(topic: string): VideoItemCategory {
  const matches = [
    /皮衣|皮革|皮面|皮質|麂皮/.test(topic) ? "leather" : undefined,
    /床組|棉被|被套|床單|枕|寢具|毯|被/.test(topic) ? "bedding" : undefined,
    /包|提把|包角|化妝包|行李箱|健身包|背包/.test(topic) ? "bags" : undefined,
    /鞋|鞋墊|鞋舌|鞋口/.test(topic) ? "shoes" : undefined,
    /衣物|襯衫|外套|西裝|羽絨|褲|裙|運動衣/.test(topic) ? "clothing" : undefined
  ].filter((value): value is VideoItemCategory => Boolean(value));
  if (matches.length > 1) return "mixed";
  if (matches[0]) return matches[0];
  return "mixed";
}

export function getVideoItemProfile(category: VideoItemCategory): VideoItemProfile {
  return profiles[category];
}

export function profileForVideoTopic(topic: string): VideoItemProfile {
  return getVideoItemProfile(inferVideoItemCategory(topic));
}

export function withVideoItemProfilePrompt(prompt: string, topic: string): string {
  const profile = profileForVideoTopic(topic);
  const marker = `Item profile ${profile.version}:`;
  if (prompt.includes(marker)) return prompt;
  return `${prompt}\n\n${marker} ${profile.prompt_directive}`;
}
