export type Platform = "facebook" | "instagram";

export type PostStatus = "pending" | "success" | "dry_run" | "posted" | "failed" | "skipped" | "missed";

export type Category = "知識文" | "情境文";

export type VisualRoute = "shop-inspection" | "macro-detail" | "customer-consultation";

export type TrafficRoute = "object-proof" | "value-prop-lead" | "dwell-detail" | "share-worthy-care" | "trust-reset";

export interface SlotSchedule {
  slot: number;
  time: string;
  category: Category;
}

export interface DailyContext {
  date: string;
  timezone: string;
  generated_at: string;
  weather: {
    location: string;
    summary: string;
    care_bridge: string;
  };
  local_hooks: string[];
  warnings: string[];
}

export interface DailySlot {
  slot: number;
  time: string;
  category: Category;
  topic: string;
  format?: string;
  instagram_caption: string;
  facebook_caption: string;
  image_prompt: string;
  visual_route: VisualRoute;
  traffic_route: TrafficRoute;
  views_target?: number;
  follower_target?: number;
  follow_cta?: string;
  seo_sync_page?: string;
  ten_day_review_metric?: string;
  content_plan_source?: "growth-playbook" | "legacy-template";
  local_image_path: string;
  public_image_url: string;
  status: PostStatus;
}

export interface DailyContent {
  date: string;
  timezone: string;
  generated_at: string;
  slots: DailySlot[];
}

export interface ImageSourceRecord {
  date: string;
  slot: number;
  source: string;
  image_path: string;
  marked_at: string;
}

export interface ApprovalLogEntry {
  date: string;
  slot: number;
  platform: Platform;
  status: "approved";
  approved_by: string;
  note?: string;
  created_at: string;
}

export interface PostLogEntry {
  date: string;
  slot: number;
  platform: Platform;
  status: PostStatus;
  dry_run: boolean;
  attempts: number;
  post_id?: string;
  error?: string;
  created_at: string;
}

export interface AppConfig {
  dryRun: boolean;
  timezone: string;
  graphApiVersion: string;
  metaAccessToken?: string;
  metaAnalyticsAccessToken?: string;
  facebookPageId?: string;
  instagramUserId?: string;
  publicSiteBaseUrl: string;
  publicImageBaseUrl: string;
  publicRootPagesRepo: string;
  verifyPublicImageUrl: boolean;
}

export interface PostInput {
  date: string;
  slot: number;
  caption: string;
  imageUrl: string;
}

export interface PostResult {
  platform: Platform;
  status: Exclude<PostStatus, "pending" | "missed">;
  dry_run: boolean;
  attempts: number;
  post_id?: string;
}
