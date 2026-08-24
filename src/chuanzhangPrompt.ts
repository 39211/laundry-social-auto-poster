// 船长AI视界 doctrine assembler for the daily companion-video motion prompts.
//
// 2026-08-25: the owner rejected the old single-paragraph English prompts as
// 太AI, supplied the chuanzhang reference corpus (docs-internal/chuanzhang/,
// reference files fetched from the source repo), and explicitly accepted two
// videos generated with this exact structure (slot 1 sneakers, slot 2 gown).
// This module turns that accepted shape into the default: fixed opening line,
// the four Chinese control blocks up front, an @image1 handle, a shot-count
// warning, two internally-timed shots, ambient audio, and only shot-relevant
// warnings -- no fixed English ban-tail, no duration/ratio inside the text
// (those live in the generation parameters).
//
// Reels floor is 10 seconds (owner directive 2026-08-24: 「我要的RELLS至少要10秒」).

export type ChuanzhangFamily = "shoe" | "bedding" | "bag" | "doll" | "garment";
export type ChuanzhangScene = "inspection-counter" | "apartment-entryway";

export const CHUANZHANG_RAW_SECONDS = 10;

export interface ChuanzhangMotionInput {
  /** 完整物件中文名,例如「鞋子」「被套」。 */
  objectZh: string;
  family: ChuanzhangFamily;
  scene: ChuanzhangScene;
  /** 首幀畫面的中文描述(沿用 first_frame_direction 的素材)。 */
  firstFrameZh: string;
  /** 單一主要動作,中文。 */
  actionZh: string;
  /** 動作完成後停住的收尾狀態,中文。 */
  endStateZh: string;
  /** 本鏡頭相關的防錯(僅列相關項,中文,不含固定尾巴)。 */
  extraWarningsZh?: string[];
}

// 物件材質:把泛稱拆成具體事件(MICRO_BEATS 的物件版)。每個家族的措辭
// 來自 2026-08-25 老闆過稿的那兩支 prompt 與手冊材質字典。
const MATERIAL_BLOCKS: Record<ChuanzhangFamily, string> = {
  shoe: "穿舊的鞋:中底膠邊氧化成不均勻的琥珀色、越靠近鞋底越深;網布或鞋面有洗不掉的灰色摩擦帶;鞋帶孔周圍一圈汗漬變深;後跟內裡起毛且磨深。",
  bedding: "用過的布品:布面有真實壓折痕與纖維方向光澤;包邊縫線完整;洗標縫在原位、邊角自然翹起;沒有全新平整的假象。",
  bag: "使用中的包袋:提把固定點與縫線完整;五金有細刮與霧面反光、不是液態鏡面;邊角有自然磨圓與色澤變化;皮面或布面有真實毛孔與紋理。",
  doll: "陪伴過的絨毛娃娃:毛絨有方向與根部密度、局部壓扁;接縫完整;填充體積自然不均;臉部特徵保持原樣。",
  garment: "穿過的衣物:領口與袖口有使用痕跡;縫線與褶線自然;布面有纖維方向的光澤變化與微小起毛;不是全新無皺的假象。"
};

const LIGHT_BLOCKS: Record<ChuanzhangScene, string> = {
  "inspection-counter": "主光為店門窗光單側入射,天花板日光燈弱補光,粉紅色裁切墊上亮度不均,接觸陰影柔和但存在。",
  "apartment-entryway": "背景暖色門燈為主光,牆面反射弱補光,長凳或地墊上有柔和接觸陰影,景深自然。"
};

const SCENE_NAMES: Record<ChuanzhangScene, string> = {
  "inspection-counter": "洗衣店檢查台",
  "apartment-entryway": "住家玄關"
};

const PHYSICS_BLOCKS: Record<ChuanzhangFamily, string> = {
  shoe: "鞋子有真實重量:被移動時先微傾再落定;鞋帶擺動一次後靜止;手指按壓處材質凹陷又回彈;接觸陰影跟著鞋底移動。",
  bedding: "布品有布料的重量:被掀起或放下時下緣先垂墜再跟上;折痕隨動作自然變化;放定後輕微回彈才靜止。",
  bag: "包袋有結構重量:被旋轉或提起時保持形狀、不軟塌變形;提把受力自然擺動一次;放定後接觸陰影穩定。",
  doll: "娃娃有填充物的重量:被移動時肢體自然下垂;毛絨受手指壓過會留下短暫壓痕再回彈;放定後不再滑動。",
  garment: "衣物有布料的重量:被掀起時布邊先垂墜;領口或布邊翻開後保持翻開的形狀;放手後輕微回落才靜止。"
};

const BASE_WARNINGS: Record<ChuanzhangFamily, string[]> = {
  shoe: ["⚠️物件恆定:全程同一雙鞋、同款同磨損,禁止變成新鞋或他款。"],
  bedding: ["⚠️物件恆定:全程同一件布品,洗標與縫線位置不變。"],
  bag: ["⚠️物件恆定:全程同一個包袋,提把、五金與縫線不變。"],
  doll: ["⚠️物件恆定:全程同一隻娃娃,五官、接縫與毛色不變。"],
  garment: ["⚠️物件恆定:全程同一件衣物,顏色、縫線與磨損位置不變。"]
};

export function buildChuanzhangMotionPrompt(input: ChuanzhangMotionInput): string {
  const light = LIGHT_BLOCKS[input.scene];
  const sceneName = SCENE_NAMES[input.scene];
  const warnings = [
    ...BASE_WARNINGS[input.family],
    "⚠️多餘肢體:只有一隻手,五指健全,無人物頭部,無第二隻手進入,無重複物件。",
    "⚠️漂浮道具:物件必須有接觸陰影和重量,不得懸空、穿模或變形。",
    "⚠️文字污染:畫面中不得出現任何文字、標誌或浮水印。",
    ...(input.extraWarningsZh ?? [])
  ];

  return [
    "不要出现BGM，不要出现字幕",
    "",
    `【全局画质】手機隨手拍質感,輕微手持晃動貫穿全程,室內自動白平衡略偏暖,暗部有輕微感光噪點,真實物理;不要三維渲染感、不要廣告感、不要平滑穩定器運鏡、不要慢動作。`,
    `【物件材質】${MATERIAL_BLOCKS[input.family]}`,
    `【灯光与风格】${light}`,
    `【核心物理】${PHYSICS_BLOCKS[input.family]}`,
    "",
    `@image1（起始画面）——${input.firstFrameZh}保持此場景與此${input.objectZh}不變。`,
    "",
    "⚠️本视频严格只有2个镜头——禁止添加额外镜头，禁止自动补镜头。",
    "",
    "【镜头1｜0.0-3.0秒】",
    `画面动作概述：固定機位先讓觀眾看清${sceneName}上的${input.objectZh}與它的狀態,無人出現。`,
    `画面构图：${input.firstFrameZh}`,
    "机位：手機主鏡頭約26mm,胸口高度微俯,固定機位僅有手持呼吸感微晃。",
    `动作：無人物動作;鏡頭極緩慢向${input.objectZh}微推約5%,讓材質細節成為焦點。`,
    "音效：室內安靜環境低鳴。",
    "",
    "【镜头2｜3.0-10.0秒】（同机位延续，无剪辑跳变）",
    `画面动作概述：一隻成年人的手從畫面邊緣進入,完成唯一動作後退出,${input.objectZh}落定。`,
    `画面构图：手從右緣進入,${input.objectZh}保持在畫面中心區域,場景其他物件不動。`,
    "机位：同鏡頭1固定機位,手持微晃持續,不推不拉。",
    `动作：同一隻成人手只做一個主要動作(one dominant action only):${input.actionZh}動作完成後,${input.endStateZh}最後一秒畫面完全靜止。`,
    "音效：手與材質接觸的細微摩擦聲。",
    "",
    "环境活动 / 全场音效：安靜室內,僅有空調低頻與遠處環境聲。",
    "",
    ...warnings
  ].join("\n");
}
