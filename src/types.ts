export type Platform = "facebook" | "instagram";

export type PostStatus = "pending" | "success" | "dry_run" | "posted" | "failed" | "skipped";

export type Category =
  | "知識文"
  | "情境文"
  | "優惠提醒"
  | "生活洗衣小技巧"
  | "品牌形象文";

export interface SlotSchedule {
  slot: number;
  time: string;
  category: Category;
}

export interface DailySlot {
  slot: number;
  time: string;
  category: Category;
  topic: string;
  instagram_caption: string;
  facebook_caption: string;
  image_prompt: string;
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
  facebookPageId?: string;
  instagramUserId?: string;
  publicImageBaseUrl: string;
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
  status: Exclude<PostStatus, "pending">;
  dry_run: boolean;
  attempts: number;
  post_id?: string;
}
