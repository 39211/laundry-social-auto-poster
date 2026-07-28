import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMain } from "./cli";
import {
  buildGrowthPlaybook,
  COMPANION_MEDIA_START_DATE,
  flattenGrowthPlaybook
} from "./growthPlaybook";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";

export interface MultimediaOperationsPlan {
  version: "2026-07-28-v2";
  generated_at: string;
  effective_date: "2026-07-29";
  state: {
    handoff_ready: true;
    generated: false;
    validated: false;
    publish_authorized: false;
    included_in_kpi: false;
  };
  operating_goal: string;
  daily_runbook: Array<{
    time: string;
    action: string;
    gate: string;
  }>;
  creative_system: {
    caption: string[];
    four_image_roles: string[];
    companion_video_timeline: string[];
    postproduction: string[];
  };
  platform_strategy: {
    instagram: string;
    facebook: string;
    current_automation_limit: string;
  };
  measurement: {
    entry_rule: string;
    review_window: string;
    primary_metrics: string[];
    working_targets: string[];
  };
  days: Array<{
    date: string;
    slots: Array<{
      slot: number;
      time: string;
      topic: string;
      content_role: string;
      caption_goal: string;
      seo_sync_page: string;
      image_count: 4;
      video_required: true;
      video_hook: string;
      video_action: string;
      tts_script: string;
      publish_authorized: false;
      included_in_kpi: false;
    }>;
  }>;
}

export function buildMultimediaOperationsPlan(now = new Date()): MultimediaOperationsPlan {
  const playbook = buildGrowthPlaybook("2026-07-11", 90);
  const futureRows = flattenGrowthPlaybook(playbook).filter(
    (slot) => slot.date >= COMPANION_MEDIA_START_DATE
  );
  const dates = [...new Set(futureRows.map((slot) => slot.date))];

  return {
    version: "2026-07-28-v2",
    generated_at: now.toISOString(),
    effective_date: COMPANION_MEDIA_START_DATE,
    state: {
      handoff_ready: true,
      generated: false,
      validated: false,
      publish_authorized: false,
      included_in_kpi: false
    },
    operating_goal:
      "每天維持 11:30 觸及答案與 19:30 證據轉換兩個主題；每個主題先完成四張圖與一支短片，用 72 小時實際觸及、收藏、分享、LINE 點擊、詢問與預約決定下一輪，不把草稿或測試素材當成成長。",
    daily_runbook: [
      { time: "06:30", action: "同步前日 QA 與最近 72 小時合格樣本，重建兩篇內容", gate: "缺失值保留 null；每輪只測一個 hook 變數" },
      { time: "06:45", action: "腳本機器審查與最多三輪定向修正", gate: "兩篇各至少 90 分，前三秒直接說物件或痛點" },
      { time: "07:00", action: "每篇產出四張 4:5 Codex 圖片與 9:16 首幀", gate: "物件一致、幾何與重量合理、無假品牌" },
      { time: "07:30", action: "Hermes xAI OAuth 呼叫 Grok Image-to-video", gate: "每片只做一個物理動作，每個 slot 最多三輪" },
      { time: "08:30", action: "獨立繁中 TTS 與 12 秒 1080×1920 後製", gate: "完全移除生成原音，TTS 逐字符合鎖定腳本" },
      { time: "09:15", action: "Grok 內容複審與 Sol 完整解碼／全幀複審", gate: "雙複審、SHA-256、prompt 新鮮度全部通過" },
      { time: "10:20", action: "兩個 slot 分別執行發布核准", gate: "影片失敗改走合格四圖並標記 VIDEO_DEFERRED；圖片或發布授權失敗才阻擋" },
      { time: "10:45", action: "11:30 時段平台與公開資產前置檢查", gate: "未完成核准與平台預檢即 NO-GO" },
      { time: "11:30", action: "觸及答案時段", gate: "只有明確發布授權後才可發布" },
      { time: "18:45", action: "19:30 時段平台與公開資產前置檢查", gate: "未完成核准與平台預檢即 NO-GO" },
      { time: "19:30", action: "證據轉換時段", gate: "只有明確發布授權後才可發布" },
      { time: "20:30", action: "同步當日發布結果與洞察", gate: "只記錄平台實際回傳成功的內容" }
    ],
    creative_system: {
      caption: [
        "第 1 句：物件＋立即衝突，讓人不展開全文也知道可以送洗或該先檢查什麼",
        "第 2 段固定品牌名；中段只講一個判斷與一個避免事項",
        "結尾只留一個動作：IG 點個人檔案連結加 LINE；FB 使用可追蹤 LINE 路徑"
      ],
      four_image_roles: [
        "圖 1：物件與問題鉤子",
        "圖 2：材質、位置或結構證據",
        "圖 3：不要做的錯誤動作",
        "圖 4：拍照清單與 LINE 收送 CTA"
      ],
      companion_video_timeline: [
        "0.0–1.5 秒：直接說「這件也可以送洗」或具體痛點",
        "1.5–6.0 秒：Grok 原片只做一個物理動作",
        "6.0–9.5 秒：四圖證據細節快速蒙太奇",
        "9.5–12.0 秒：台中市全區免費收送＋LINE CTA"
      ],
      postproduction: [
        "動態標題、局部放大框、節奏切點與品牌色塊由後製完成",
        "使用獨立可理解的繁中 TTS，不使用 Grok 生成片原音",
        "輸出 1080×1920 主檔；IG 使用四圖加影片混合輪播，FB 使用同文案 Reel",
        "Grok 與 Sol 都必須通過，審核紀錄綁定當日 prompt 與最終 MP4 SHA-256",
        "不得生成假清潔成果、假顧客見證或無證據 before/after"
      ]
    },
    platform_strategy: {
      instagram:
        "同一則貼文使用四張圖＋一支影片的 mixed carousel；先建立並等待影片 child FINISHED，再建立父容器，每次發布仍須 live preflight。",
      facebook:
        "使用同一文案發布 12 秒 Reel；四張圖的證據內容已編入影片蒙太奇，不另增加貼文數。",
      current_automation_limit:
        "發布器已具備 FB Reel、IG mixed carousel 與明確圖片 fallback；影片失敗時記錄 VIDEO_DEFERRED 並發布合格圖片，缺圖片、核准、公開資產或 live preflight 才阻擋。"
    },
    measurement: {
      entry_rule: "只有 FB 與 IG 都實際發布成功，且到達較晚平台發布時間後 72 小時的內容，才進入 KPI。",
      review_window: "每篇滿 72 小時複盤；搜尋以 28 天 GSC 視窗評估。",
      primary_metrics: ["reach", "views", "saves", "shares", "LINE clicks", "inquiries", "bookings"],
      working_targets: [
        "未來 14 天雙平台發布履約率至少 95%",
        "28 天 GSC CTR 工作目標至少 3%，不是排名保證",
        "LINE 點擊、詢問與預約完整回填率 100%"
      ]
    },
    days: dates.map((date) => ({
      date,
      slots: futureRows
        .filter((slot) => slot.date === date)
        .map((slot) => ({
          slot: slot.slot,
          time: slot.time,
          topic: slot.topic,
          content_role: slot.content_role,
          caption_goal:
            slot.slot === 1
              ? "用一個可搜尋、可收藏的具體答案取得非粉絲觸及"
              : "用一個生活情境與免費收送 CTA 推進 LINE 詢問",
          seo_sync_page: slot.seo_sync_page,
          image_count: 4,
          video_required: true,
          video_hook: slot.video_candidate?.memory_hook ?? `${slot.topic}也可以送洗`,
          video_action: slot.video_candidate?.single_action ?? "單一物件、單一動作",
          tts_script: `${slot.video_candidate?.memory_hook ?? slot.topic}。拍好全貌和細節，LINE 預約台中全區免費收送。`,
          publish_authorized: false,
          included_in_kpi: false
        }))
    }))
  };
}

function toMarkdown(plan: MultimediaOperationsPlan): string {
  const tomorrow = plan.days[0];
  return [
    "# 私享家 90 天四圖＋影片營運計畫",
    "",
    `- 生效日：${plan.effective_date}`,
    `- 狀態：handoff_ready=${plan.state.handoff_ready}；generated=${plan.state.generated}；validated=${plan.state.validated}`,
    `- 發布授權：${plan.state.publish_authorized}`,
    `- 計入 KPI：${plan.state.included_in_kpi}`,
    "",
    "## 明日兩個時段",
    "",
    ...(tomorrow?.slots ?? []).map(
      (slot) =>
        `- ${slot.time}｜${slot.topic}｜4 張 4:5 圖＋1 支 12 秒 9:16 短片｜${slot.caption_goal}`
    ),
    "",
    "## 每日流程",
    "",
    ...plan.daily_runbook.map((item) => `- ${item.time}｜${item.action}｜Gate：${item.gate}`),
    "",
    "## 影片節奏",
    "",
    ...plan.creative_system.companion_video_timeline.map((item) => `- ${item}`),
    "",
    "## 平台限制",
    "",
    `- Instagram：${plan.platform_strategy.instagram}`,
    `- Facebook：${plan.platform_strategy.facebook}`,
    `- 現況：${plan.platform_strategy.current_automation_limit}`,
    "",
    "## KPI 進場規則",
    "",
    `- ${plan.measurement.entry_rule}`,
    `- ${plan.measurement.review_window}`,
    ""
  ].join("\n");
}

export async function writeMultimediaOperationsPlan(
  root = projectRoot(),
  now = new Date()
): Promise<[string, string]> {
  const plan = buildMultimediaOperationsPlan(now);
  const outputDir = join(root, "output", "operations");
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "90-day-multimedia-operations-plan.json");
  const markdownPath = join(outputDir, "90-day-multimedia-operations-plan.md");
  await writeJsonAtomic(jsonPath, plan);
  await writeFile(markdownPath, `${toMarkdown(plan)}\n`, "utf8");
  return [jsonPath, markdownPath];
}

if (isMain(import.meta.url)) {
  writeMultimediaOperationsPlan()
    .then((paths) => paths.forEach((path) => console.log(`Multimedia operations plan ready: ${path}`)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
