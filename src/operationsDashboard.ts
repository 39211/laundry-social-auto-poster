import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildGrowthPlaybook, type GrowthPlaybookSlot } from "./growthPlaybook";
import {
  loadApprovalLog,
  loadDailyContent,
  loadImageSources,
  loadPostLog,
  loadVideoSources,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { isPublishableImageSource } from "./imageSources";
import { imageAssetsForSlot } from "./mediaAssets";
import {
  assetFilePath,
  docsContentCalendarPath,
  projectRoot,
  videoAssetFilePath
} from "./paths";
import type {
  ApprovalLogEntry,
  DailyContent,
  DailySlot,
  Platform,
  PostLogEntry
} from "./types";
import { assessReelRunFreshness } from "./videoRunFreshness";

const TIMEZONE = "Asia/Taipei";
const PLATFORMS: Platform[] = ["facebook", "instagram"];

type ArtifactRow = Record<string, string | number | boolean | null>;

type InsightRow = {
  date?: unknown;
  slot?: unknown;
  post_id?: unknown;
  insights_ok?: unknown;
  metrics?: unknown;
  insights?: unknown;
  error?: unknown;
  insights_error?: unknown;
};

type InsightFile = {
  generated_at?: unknown;
  rows?: unknown;
};

type PublishState = "已發佈" | "失敗" | "僅演練" | "待發佈" | "計畫";

export interface OperationsSlotRow extends ArtifactRow {
  date: string;
  day: number;
  slot: number;
  time: string;
  slot_time: string;
  topic: string;
  format: string;
  phase: string;
  views_target: number;
  follower_target: number;
  content_state: string;
  media_state: string;
  facebook_approval: string;
  instagram_approval: string;
  approval_state: string;
  facebook_publish: PublishState;
  instagram_publish: PublishState;
  platform_publish: string;
  seo_aeo_geo: string;
  actual_views: number | null;
  views_plan_actual: string;
  kpi_state: string;
  overall_state: string;
  next_action: string;
}

export interface OperationsSummary extends ArtifactRow {
  current_day: number;
  total_days: number;
  today_views_target: number;
  today_follower_target: number;
  due_slots: number;
  generated_due_slots: number;
  approved_due_slots: number;
  seo_due_slots: number;
  published_due_slots: number;
  generated_rate: number;
  approval_rate: number;
  seo_rate: number;
  publish_rate: number;
  published_platform_posts: number;
  platform_view_rows: number;
  kpi_coverage: number;
}

export interface OperationsDashboardResult {
  artifact: {
    surface: "dashboard";
    manifest: Record<string, unknown>;
    snapshot: {
      version: 1;
      generatedAt: string;
      status: "ready" | "partial";
      datasets: Record<string, ArtifactRow[]>;
      accessIssues?: Array<Record<string, unknown>>;
    };
    sources: Array<Record<string, unknown>>;
  };
  summary: OperationsSummary;
  slots: OperationsSlotRow[];
}

export interface OperationsDashboardOptions {
  startDate?: string;
  totalDays?: number;
  root?: string;
  asOf?: Date;
}

function zonedParts(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
}

function dayDifference(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

async function existsWithBytes(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function exactViews(row: InsightRow | undefined, platform: Platform): number | undefined {
  if (!row || row.insights_ok !== true) return undefined;
  const metrics = platform === "instagram" ? row.metrics : row.insights;
  if (!isRecord(metrics)) return undefined;
  const entry = Object.entries(metrics).find(([key]) => key.toLowerCase() === "views");
  return entry ? numericValue(entry[1]) : undefined;
}

function insightError(row: InsightRow | undefined): string | undefined {
  const value = row?.error ?? row?.insights_error;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readInsightRows(root: string, platform: Platform): Promise<Map<string, InsightRow>> {
  const directory = join(root, "data", "insights", platform);
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }

  const rows = new Map<string, { row: InsightRow; generatedAt: string }>();
  for (const file of files) {
    const raw = await readFile(join(directory, file), "utf8");
    const payload = JSON.parse(raw.replace(/^\uFEFF/, "")) as InsightFile;
    if (!payload || !Array.isArray(payload.rows)) continue;
    const generatedAt = typeof payload.generated_at === "string" ? payload.generated_at : file;
    for (const value of payload.rows) {
      if (!isRecord(value)) continue;
      const row = value as InsightRow;
      if (typeof row.date !== "string" || typeof row.slot !== "number") continue;
      const key = `${row.date}:${row.slot}`;
      const previous = rows.get(key);
      if (!previous || generatedAt >= previous.generatedAt) rows.set(key, { row, generatedAt });
    }
  }
  return new Map([...rows].map(([key, value]) => [key, value.row]));
}

function isApproved(entries: ApprovalLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) => entry.slot === slot && entry.platform === platform && entry.status === "approved"
  );
}

function successfulLivePost(entries: PostLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      entry.platform === platform &&
      !entry.dry_run &&
      ["success", "posted"].includes(entry.status)
  );
}

function publishState(
  entries: PostLogEntry[],
  slot: number,
  platform: Platform,
  future: boolean
): PublishState {
  const matching = entries.filter((entry) => entry.slot === slot && entry.platform === platform);
  if (matching.some((entry) => !entry.dry_run && ["success", "posted"].includes(entry.status))) {
    return "已發佈";
  }
  if (matching.some((entry) => !entry.dry_run && entry.status === "failed")) return "失敗";
  if (matching.some((entry) => entry.dry_run && ["success", "dry_run"].includes(entry.status))) {
    return "僅演練";
  }
  return future ? "計畫" : "待發佈";
}

function actualSlot(calendar: DailyContent | undefined, slot: number): DailySlot | undefined {
  return calendar?.slots.find((item) => item.slot === slot);
}

function topicMatches(plan: GrowthPlaybookSlot, actual: DailySlot | undefined): boolean {
  return Boolean(actual && actual.topic === plan.topic && actual.content_plan_source === "growth-playbook");
}

function kpiState(
  instagramRow: InsightRow | undefined,
  facebookRow: InsightRow | undefined,
  instagramViews: number | undefined,
  facebookViews: number | undefined,
  published: boolean
): string {
  if (!published) return "待發佈後抓取";
  if (instagramViews !== undefined && facebookViews !== undefined) return "完整";
  if (instagramViews !== undefined || facebookViews !== undefined) return "部分";
  if (insightError(instagramRow) || insightError(facebookRow)) return "API 失敗";
  return "尚未取得";
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function currentTargets(
  days: ReturnType<typeof buildGrowthPlaybook>["days"],
  currentDay: number
): { views: number; followers: number } {
  const day = days[Math.max(0, currentDay - 1)];
  return {
    views: day?.daily_views_target ?? 0,
    followers: day?.daily_follower_target ?? 0
  };
}

const SOURCE_QUERIES = {
  plan_summary:
    "SELECT current_day, total_days, today_views_target, today_follower_target FROM summary",
  growth_playbook:
    "SELECT date, day, daily_views_target, daily_follower_target, phase FROM plan_targets ORDER BY date",
  operations_summary:
    "SELECT due_slots, generated_due_slots, approved_due_slots, seo_due_slots, published_due_slots, generated_rate, approval_rate, seo_rate, publish_rate FROM summary",
  meta_insights:
    "SELECT published_platform_posts, platform_view_rows, kpi_coverage FROM summary",
  operations_pipeline: "SELECT stage, complete_slots FROM pipeline",
  operations_slots: "SELECT * FROM slot_status ORDER BY date, slot"
} as const;

function querySource(
  id: keyof typeof SOURCE_QUERIES,
  label: string,
  description: string,
  tablesUsed: string[],
  metricDefinitions?: string[]
): Record<string, unknown> {
  return {
    id,
    label,
    path: `output/operations/queries/${id}.sql`,
    query: {
      engine: "sqlite",
      sql: SOURCE_QUERIES[id],
      description,
      tables_used: tablesUsed,
      ...(metricDefinitions ? { metric_definitions: metricDefinitions } : {})
    }
  };
}

function sourceSpecs(startDate: string): Array<Record<string, unknown>> {
  return [
    querySource(
      "plan_summary",
      "目前計畫日與當日目標",
      `從 ${startDate} 起算的 90 天母表，取目前 Day 與當日目標。`,
      ["output/operations/90-day-kpi.sqlite::summary"]
    ),
    querySource(
      "growth_playbook",
      "90 天成長母表",
      `由 content-playbooks/${startDate}_90-day-view-growth-playbook.json 產生的每日目標快照。`,
      ["output/operations/90-day-kpi.sqlite::plan_targets"]
    ),
    querySource(
      "operations_summary",
      "發佈鏈完成率",
      "逐日彙整 content calendar、approved log、posted log、媒體來源與公開 docs 狀態。",
      ["output/operations/90-day-kpi.sqlite::summary"],
      [
        "完成率分母只包含截至快照時間已到排程時間的時段。",
        "雙平台完成代表 Facebook 與 Instagram 都有對應的完整狀態。"
      ]
    ),
    querySource(
      "meta_insights",
      "Meta 洞察覆蓋率",
      "讀取 data/insights/facebook 與 data/insights/instagram；只把精確 views 欄位視為觀看數。",
      ["output/operations/90-day-kpi.sqlite::summary"],
      [
        "KPI coverage = 有精確 views 的平台貼文數 / 已正式發佈的平台貼文數。",
        "空白 actual_views 代表來源未取得，不代表觀看數為 0。"
      ]
    ),
    querySource(
      "operations_pipeline",
      "截至目前的發佈管線",
      "以同一批已到期時段核對產生、審核、公開同步與雙平台發佈。",
      ["output/operations/90-day-kpi.sqlite::pipeline"]
    ),
    querySource(
      "operations_slots",
      "90 天逐時段狀態",
      "由私有內容、素材來源、審核、公開同步、FB/IG 發佈紀錄與 Meta 洞察逐時段彙整。",
      ["output/operations/90-day-kpi.sqlite::slot_status"]
    )
  ];
}

export async function buildOperationsDashboard(
  options: OperationsDashboardOptions = {}
): Promise<OperationsDashboardResult> {
  const root = projectRoot(options.root);
  const startDate = options.startDate ?? "2026-07-11";
  const totalDays = options.totalDays ?? 90;
  const asOf = options.asOf ?? new Date();
  const generatedAt = asOf.toISOString();
  const now = zonedParts(asOf);
  const playbook = buildGrowthPlaybook(startDate, totalDays);
  const rawCurrentDay = dayDifference(startDate, now.date) + 1;
  const currentDay = Math.max(0, Math.min(totalDays, rawCurrentDay));
  const targets = currentTargets(playbook.days, currentDay);
  const [instagramInsights, facebookInsights] = await Promise.all([
    readInsightRows(root, "instagram"),
    readInsightRows(root, "facebook")
  ]);

  const slotRows = (
    await Promise.all(
      playbook.days.map(async (day) => {
        const [calendar, approvals, posts, imageSources, videoSources, publicCalendar] = await Promise.all([
          loadDailyContent(day.date, root),
          loadApprovalLog(day.date, root),
          loadPostLog(day.date, root),
          loadImageSources(day.date, root),
          loadVideoSources(day.date, root),
          readJsonFile<DailyContent | undefined>(docsContentCalendarPath(day.date, root), undefined)
        ]);

        return Promise.all(
          day.slots.map(async (plan): Promise<OperationsSlotRow> => {
            const future = day.date > now.date;
            const due = day.date < now.date || (day.date === now.date && plan.time <= now.time);
            const actual = actualSlot(calendar, plan.slot);
            const contentReady = Boolean(actual);
            const contentMatches = topicMatches(plan, actual);
            const actualImageAssets = actual ? imageAssetsForSlot(actual) : [];
            const imageReady = actual
              ? (await Promise.all(
                  actualImageAssets.map((asset) =>
                    existsWithBytes(join(root, ...asset.local_image_path.split("/")))
                  )
                )).every(Boolean)
              : await existsWithBytes(assetFilePath(day.date, plan.slot, root));
            const imageSourceReady = actual
              ? actualImageAssets.every((asset) =>
                  imageSources.some(
                    (entry) =>
                      entry.slot === plan.slot &&
                      isPublishableImageSource(entry.source) &&
                      entry.image_path === asset.local_image_path
                  )
                )
              : false;
            const isReel = actual ? actual.media_type === "reel" : plan.format === "reel";
            const videoReady = !isReel || (await existsWithBytes(videoAssetFilePath(day.date, plan.slot, root)));
            const videoSourceReady =
              !isReel || videoSources.some((entry) => entry.slot === plan.slot && entry.source === "grok-imagine-video");
            let reelFresh = true;
            let reelFreshnessMediaState = "";
            let reelFreshnessNextAction = "";
            if (isReel && contentReady && actual?.video_prompt && actual.local_video_path) {
              const freshness = await assessReelRunFreshness({
                date: day.date,
                slot: plan.slot,
                videoPrompt: actual.video_prompt,
                targetPath: actual.local_video_path,
                root
              });
              reelFresh = freshness.ok;
              if (!freshness.ok) {
                reelFreshnessMediaState = freshness.media_state;
                reelFreshnessNextAction = freshness.next_action;
              }
            } else if (isReel && contentReady) {
              reelFresh = false;
              reelFreshnessMediaState = "缺 Reel 產製紀錄";
              reelFreshnessNextAction = "重新生成 Reel";
            }
            const mediaReady = imageReady && imageSourceReady && videoReady && videoSourceReady && reelFresh;

            const facebookApproved = isApproved(approvals, plan.slot, "facebook");
            const instagramApproved = isApproved(approvals, plan.slot, "instagram");
            const fullyApproved = facebookApproved && instagramApproved;
            const facebookPublished = successfulLivePost(posts, plan.slot, "facebook");
            const instagramPublished = successfulLivePost(posts, plan.slot, "instagram");
            const fullyPublished = facebookPublished && instagramPublished;
            const facebookPublish = publishState(posts, plan.slot, "facebook", future);
            const instagramPublish = publishState(posts, plan.slot, "instagram", future);
            const publicSlot = actualSlot(publicCalendar, plan.slot);
            const seoSynced = Boolean(publicSlot);

            const insightKey = `${day.date}:${plan.slot}`;
            const instagramInsight = instagramInsights.get(insightKey);
            const facebookInsight = facebookInsights.get(insightKey);
            const instagramViews = exactViews(instagramInsight, "instagram");
            const facebookViews = exactViews(facebookInsight, "facebook");
            const viewValues = [instagramViews, facebookViews].filter(
              (value): value is number => value !== undefined
            );
            const actualViews = viewValues.length > 0 ? viewValues.reduce((sum, value) => sum + value, 0) : null;
            const insightStatus = kpiState(
              instagramInsight,
              facebookInsight,
              instagramViews,
              facebookViews,
              fullyPublished
            );

            let mediaState = "就緒";
            if (future && !contentReady) mediaState = "計畫";
            else if (!contentReady) mediaState = "未產生";
            else if (!imageReady) mediaState = actual?.media_type === "carousel" ? "缺輪播圖片" : "缺封面圖片";
            else if (!imageSourceReady) mediaState = actual?.media_type === "carousel" ? "缺輪播來源紀錄" : "缺圖片來源紀錄";
            else if (!videoReady) mediaState = "缺 Reel MP4";
            else if (!videoSourceReady) mediaState = "缺影片來源紀錄";
            else if (!reelFresh) mediaState = reelFreshnessMediaState || "Reel 創意已過期";

            const contentState = future && !contentReady ? "計畫" : !contentReady ? "未產生" : contentMatches ? "吻合母表" : "需核對母表";
            const facebookApproval = future && !contentReady ? "計畫" : facebookApproved ? "已核准" : "待審";
            const instagramApproval = future && !contentReady ? "計畫" : instagramApproved ? "已核准" : "待審";
            const approvalState =
              facebookApproval === "計畫" && instagramApproval === "計畫"
                ? "計畫"
                : fullyApproved
                  ? "FB/IG 已核准"
                  : facebookApproved || instagramApproved
                    ? "部分核准"
                    : "待審";
            const seoState = seoSynced ? "已同步" : future && !contentReady ? "計畫" : fullyApproved ? "核准後未同步" : "待核准";

            let overallState = "已發佈";
            if (future) overallState = "計畫";
            else if (fullyPublished && seoSynced) overallState = "已發佈";
            else if (!contentReady) overallState = "未產生";
            else if (!mediaReady) overallState = "素材缺件";
            else if (!fullyApproved) overallState = "待審核";
            else if (!seoSynced) overallState = "公開同步阻塞";
            else if (!fullyPublished) overallState = due ? "待發佈" : "已就緒";

            let nextAction = "完成";
            if (future) nextAction = "依排程準備";
            else if (!contentReady) nextAction = "產生內容";
            else if (!mediaReady) {
              nextAction =
                videoReady && videoSourceReady && !reelFresh && reelFreshnessNextAction
                  ? reelFreshnessNextAction
                  : `補齊素材：${mediaState}`;
            }
            else if (!fullyApproved) nextAction = "完成 FB/IG 審核";
            else if (!seoSynced) nextAction = "重建 SEO/AEO/GEO 公開資料";
            else if (!fullyPublished) {
              const pendingPlatforms: string[] = [];
              if (facebookPublish !== "已發佈") pendingPlatforms.push("FB");
              if (instagramPublish !== "已發佈") pendingPlatforms.push("IG");
              nextAction = due ? `執行 ${pendingPlatforms.join("/")} 發佈` : `等待 ${plan.time} 發佈`;
            }
            else if (insightStatus !== "完整") nextAction = "補抓 FB/IG KPI";

            return {
              date: day.date,
              day: day.day,
              slot: plan.slot,
              time: plan.time,
              slot_time: `${plan.slot} · ${plan.time}`,
              topic: plan.topic,
              format: plan.format,
              phase: day.phase,
              views_target: plan.views_target,
              follower_target: plan.follower_target,
              content_state: contentState,
              media_state: mediaState,
              facebook_approval: facebookApproval,
              instagram_approval: instagramApproval,
              approval_state: approvalState,
              facebook_publish: facebookPublish,
              instagram_publish: instagramPublish,
              platform_publish: `FB ${facebookPublish} / IG ${instagramPublish}`,
              seo_aeo_geo: seoState,
              actual_views: actualViews,
              views_plan_actual: `${plan.views_target}/${actualViews ?? "—"}`,
              kpi_state: insightStatus,
              overall_state: overallState,
              next_action: nextAction,
              due
            };
          })
        );
      })
    )
  ).flat();

  const dueRows = slotRows.filter((row) => row.due === true);
  const generatedDue = dueRows.filter((row) => row.content_state !== "未產生").length;
  const approvedDue = dueRows.filter(
    (row) => row.facebook_approval === "已核准" && row.instagram_approval === "已核准"
  ).length;
  const seoDue = dueRows.filter((row) => row.seo_aeo_geo === "已同步").length;
  const publishedDue = dueRows.filter(
    (row) => row.facebook_publish === "已發佈" && row.instagram_publish === "已發佈"
  ).length;
  const publishedPlatformPosts = slotRows.reduce(
    (sum, row) =>
      sum + Number(row.facebook_publish === "已發佈") + Number(row.instagram_publish === "已發佈"),
    0
  );
  const platformViewRows = slotRows.reduce((sum, row) => {
    const key = `${row.date}:${row.slot}`;
    return (
      sum +
      Number(row.facebook_publish === "已發佈" && exactViews(facebookInsights.get(key), "facebook") !== undefined) +
      Number(row.instagram_publish === "已發佈" && exactViews(instagramInsights.get(key), "instagram") !== undefined)
    );
  }, 0);

  const summary: OperationsSummary = {
    current_day: currentDay,
    total_days: totalDays,
    today_views_target: targets.views,
    today_follower_target: targets.followers,
    due_slots: dueRows.length,
    generated_due_slots: generatedDue,
    approved_due_slots: approvedDue,
    seo_due_slots: seoDue,
    published_due_slots: publishedDue,
    generated_rate: safeRate(generatedDue, dueRows.length),
    approval_rate: safeRate(approvedDue, dueRows.length),
    seo_rate: safeRate(seoDue, dueRows.length),
    publish_rate: safeRate(publishedDue, dueRows.length),
    published_platform_posts: publishedPlatformPosts,
    platform_view_rows: platformViewRows,
    kpi_coverage: safeRate(platformViewRows, publishedPlatformPosts)
  };

  const accessIssues: Array<Record<string, unknown>> = [];
  if (publishedPlatformPosts > platformViewRows) {
    accessIssues.push({
      id: "meta_views_coverage",
      scope: "FB/IG views KPI",
      sourceId: "meta_insights",
      dataset: "slot_status",
      message: `已正式發佈 ${publishedPlatformPosts} 個平台貼文，但只有 ${platformViewRows} 筆取得精確 views；空值不可解讀為 0。`
    });
  }
  accessIssues.push({
    id: "follower_growth_source",
    scope: "每日新增追蹤",
    sourceId: "meta_insights",
    dataset: "summary",
    message: "目前沒有可核對的 FB/IG 帳號層級每日 follower growth 時序來源，僅顯示計畫目標。"
  });

  const planTargets: ArtifactRow[] = playbook.days.map((day) => ({
    date: day.date,
    day: day.day,
    daily_views_target: day.daily_views_target,
    daily_follower_target: day.daily_follower_target,
    phase: day.phase
  }));
  const pipeline: ArtifactRow[] = [
    { stage: "應完成", complete_slots: dueRows.length },
    { stage: "已產生", complete_slots: generatedDue },
    { stage: "已審核", complete_slots: approvedDue },
    { stage: "SEO/AEO/GEO", complete_slots: seoDue },
    { stage: "FB/IG 已發佈", complete_slots: publishedDue }
  ];
  const sources = sourceSpecs(startDate);

  const manifest: Record<string, unknown> = {
    version: 1,
    surface: "dashboard",
    title: "私享家 90 天發佈與 KPI",
    description: "管理每日兩篇內容、素材、審核、SEO/AEO/GEO、Facebook、Instagram 與 KPI 資料品質。",
    generatedAt,
    cards: [
      {
        id: "plan_day",
        dataset: "summary",
        sourceId: "plan_summary",
        description: "目前所在的 90 天計畫日；尚未開始時顯示 0，結束後停在 90。",
        metrics: [
          { label: "目前 Day", field: "current_day", format: "number" },
          { label: "總天數", field: "total_days", format: "number" }
        ]
      },
      {
        id: "views_target",
        dataset: "summary",
        sourceId: "plan_summary",
        description: "當日兩時段合計的觀看數計畫目標。",
        metrics: [{ label: "今日 views 目標", field: "today_views_target", format: "number" }]
      },
      {
        id: "follower_target",
        dataset: "summary",
        sourceId: "plan_summary",
        description: "當日新增追蹤計畫目標；實際值需帳號層級洞察來源。",
        metrics: [{ label: "今日追蹤目標", field: "today_follower_target", format: "number" }]
      },
      {
        id: "approval_rate",
        dataset: "summary",
        sourceId: "operations_summary",
        description: "已到期時段中，Facebook 與 Instagram 都完成審核的比例。",
        metrics: [
          { label: "雙平台審核率", field: "approval_rate", format: "percent" },
          { label: "已審核時段", field: "approved_due_slots", format: "number" },
          { label: "應完成時段", field: "due_slots", format: "number" }
        ]
      },
      {
        id: "seo_rate",
        dataset: "summary",
        sourceId: "operations_summary",
        description: "已到期時段中，核准內容已出現在公開 SEO/AEO/GEO content calendar 的比例。",
        metrics: [
          { label: "公開同步率", field: "seo_rate", format: "percent" },
          { label: "已同步時段", field: "seo_due_slots", format: "number" },
          { label: "應完成時段", field: "due_slots", format: "number" }
        ]
      },
      {
        id: "publish_rate",
        dataset: "summary",
        sourceId: "operations_summary",
        description: "已到期時段中，Facebook 與 Instagram 都有正式成功紀錄的比例。",
        metrics: [
          { label: "雙平台發佈率", field: "publish_rate", format: "percent" },
          { label: "已發佈時段", field: "published_due_slots", format: "number" },
          { label: "應完成時段", field: "due_slots", format: "number" }
        ]
      },
      {
        id: "kpi_coverage",
        dataset: "summary",
        sourceId: "meta_insights",
        description: "已正式發佈的平台貼文中，取得精確 views 的比例；未取得不等於 0。",
        metrics: [
          { label: "views 資料覆蓋", field: "kpi_coverage", format: "percent" },
          { label: "有 views 筆數", field: "platform_view_rows", format: "number" },
          { label: "已發佈平台貼文", field: "published_platform_posts", format: "number" }
        ]
      }
    ],
    charts: [
      {
        id: "views_target_trend",
        title: "90 天每日 views 目標",
        subtitle: "每日兩個時段合計；實際 views 僅在來源提供精確 views 時顯示於明細。",
        type: "line",
        dataset: "plan_targets",
        sourceId: "growth_playbook",
        encodings: {
          x: { field: "date", type: "temporal", label: "日期" },
          // Keep the axis label short so the portable reader y-axis gutter stays
          // inside the desktop content column at 1440px.
          y: { field: "daily_views_target", type: "quantitative", label: "views 目標" },
          tooltip: [
            { field: "day", type: "quantitative", label: "Day" },
            { field: "daily_follower_target", type: "quantitative", label: "追蹤目標" },
            { field: "phase", type: "text", label: "階段" }
          ]
        },
        layout: "full",
        maxRows: totalDays
      },
      {
        id: "due_pipeline",
        title: "截至目前的發佈管線",
        subtitle: `以已到期的 ${dueRows.length} 個時段為共同分母。`,
        type: "bar",
        dataset: "pipeline",
        sourceId: "operations_pipeline",
        encodings: {
          x: { field: "stage", type: "ordinal", label: "階段" },
          y: { field: "complete_slots", type: "quantitative", label: "時段" }
        },
        layout: "full"
      }
    ],
    tables: [
      {
        id: "slot_status_table",
        title: "90 天逐時段管理表",
        subtitle: "180 個時段；可依日期核對素材、審核、雙平台、公開同步、KPI 與下一步。",
        dataset: "slot_status",
        sourceId: "operations_slots",
        defaultSort: { field: "date", direction: "asc" },
        // Spacious density lets long topics wrap. Dense nowrap + 11 columns made
        // the ops table ~1443px and pushed root horizontal overflow at 1440px.
        density: "spacious",
        layout: "full",
        // Visible columns only. format/overall_state stay on the snapshot rows
        // for source drill-down and KPI logic, but are not rendered as table columns.
        columns: [
          { field: "date", label: "日期", type: "date", sizing: "content" },
          { field: "slot_time", label: "時段", sizing: "content" },
          { field: "topic", label: "主題" },
          { field: "media_state", label: "素材", sizing: "content" },
          { field: "approval_state", label: "審核", sizing: "content" },
          { field: "platform_publish", label: "FB/IG", sizing: "content" },
          { field: "seo_aeo_geo", label: "SEO", sizing: "content" },
          { field: "views_plan_actual", label: "views", sizing: "content" },
          { field: "next_action", label: "下一步" }
        ]
      }
    ],
    sources,
    blocks: [
      {
        id: "plan_metrics",
        type: "metric-strip",
        cardIds: ["plan_day", "views_target", "follower_target"]
      },
      {
        id: "operations_metrics",
        type: "metric-strip",
        cardIds: ["approval_rate", "seo_rate", "publish_rate", "kpi_coverage"]
      },
      { id: "views_target_chart", type: "chart", chartId: "views_target_trend" },
      { id: "pipeline_chart", type: "chart", chartId: "due_pipeline" },
      {
        id: "quality_note",
        type: "markdown",
        body: "### KPI 資料品質\n實際 views 與 follower growth 只有在來源成功提供時才顯示；空白代表未取得，不代表成效為零。"
      },
      { id: "slot_status", type: "table", tableId: "slot_status_table" }
    ]
  };

  const snapshot = {
    version: 1 as const,
    generatedAt,
    status: accessIssues.length > 0 ? ("partial" as const) : ("ready" as const),
    datasets: {
      summary: [summary],
      plan_targets: planTargets,
      pipeline,
      slot_status: slotRows
    },
    ...(accessIssues.length > 0 ? { accessIssues } : {})
  };

  return {
    artifact: {
      surface: "dashboard",
      manifest,
      snapshot,
      sources
    },
    summary,
    slots: slotRows
  };
}

function quoteSqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
}

function sqliteColumnType(rows: ArtifactRow[], field: string): "REAL" | "INTEGER" | "TEXT" {
  const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
  if (values.length > 0 && values.every((value) => typeof value === "number")) return "REAL";
  if (values.length > 0 && values.every((value) => typeof value === "boolean")) return "INTEGER";
  return "TEXT";
}

async function writeOperationsSqliteSnapshot(
  root: string,
  datasets: Record<string, ArtifactRow[]>
): Promise<void> {
  const outputDirectory = join(root, "output", "operations");
  const queryDirectory = join(outputDirectory, "queries");
  await mkdir(queryDirectory, { recursive: true });

  let DatabaseSync: typeof import("node:sqlite")["DatabaseSync"];
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error("Generating the operations dashboard SQLite snapshot requires Node.js 22.5 or newer.");
  }

  const database = new DatabaseSync(join(outputDirectory, "90-day-kpi.sqlite"));
  try {
    for (const [dataset, rows] of Object.entries(datasets)) {
      const table = quoteSqlIdentifier(dataset);
      const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      if (fields.length === 0) throw new Error(`Dataset ${dataset} has no columns.`);
      database.exec(`DROP TABLE IF EXISTS ${table}`);
      const columns = fields
        .map((field) => `${quoteSqlIdentifier(field)} ${sqliteColumnType(rows, field)}`)
        .join(", ");
      database.exec(`CREATE TABLE ${table} (${columns})`);
      const placeholders = fields.map(() => "?").join(", ");
      const insert = database.prepare(
        `INSERT INTO ${table} (${fields.map(quoteSqlIdentifier).join(", ")}) VALUES (${placeholders})`
      );
      database.exec("BEGIN");
      try {
        for (const row of rows) {
          insert.run(
            ...fields.map((field) => {
              const value = row[field];
              if (value === undefined) return null;
              return typeof value === "boolean" ? Number(value) : value;
            })
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    for (const [sourceId, sql] of Object.entries(SOURCE_QUERIES)) {
      const expectedDataset =
        sourceId === "growth_playbook"
          ? "plan_targets"
          : sourceId === "operations_pipeline"
            ? "pipeline"
            : sourceId === "operations_slots"
              ? "slot_status"
              : "summary";
      const rows = database.prepare(sql).all();
      if (rows.length !== datasets[expectedDataset]?.length) {
        throw new Error(`SQLite source query ${sourceId} did not reconcile with dataset ${expectedDataset}.`);
      }
      await writeFile(join(queryDirectory, `${sourceId}.sql`), `${sql};\n`, "utf8");
    }
  } finally {
    database.close();
  }
}

export async function writeOperationsDashboardArtifact(
  options: OperationsDashboardOptions & { outputPath?: string } = {}
): Promise<{ path: string; result: OperationsDashboardResult }> {
  const root = projectRoot(options.root);
  const result = await buildOperationsDashboard(options);
  const outputPath = options.outputPath ?? join(root, "output", "operations", "90-day-kpi.artifact.json");
  await writeOperationsSqliteSnapshot(root, result.artifact.snapshot.datasets);
  await writeJsonAtomic(outputPath, result.artifact);
  return { path: outputPath, result };
}
