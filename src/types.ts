export type Platform = "facebook" | "instagram";

export type MediaType = "image" | "carousel" | "reel" | "mixed-carousel";

export type PostStatus = "pending" | "success" | "dry_run" | "posted" | "failed" | "skipped" | "missed";

export type Category = "知識文" | "情境文";

export type VisualRoute = "shop-inspection" | "macro-detail" | "customer-consultation";

export type TrafficRoute = "object-proof" | "value-prop-lead" | "dwell-detail" | "share-worthy-care" | "trust-reset";

export type ContentRole = "reach-answer" | "evidence-conversion";

export type SearchIntent =
  | "local-discovery"
  | "problem-diagnosis"
  | "service-comparison"
  | "trust-proof"
  | "pickup-logistics"
  | "aftercare";

export type SearchEvidenceType =
  | "verified-business-fact"
  | "first-party-inspection"
  | "real-case-photo"
  | "service-boundary"
  | "customer-question"
  | "pickup-logistics";

export interface VideoCandidatePlan {
  status: "concept_ready";
  memory_hook: string;
  conflict: string;
  single_action: string;
  payoff: string;
  cta: string;
  duration_seconds: 12;
  aspect_ratio: "9:16";
  first_frame_direction: string;
  grok_motion_prompt: string;
  fallback_media_type: "image";
}

export interface CompanionMediaPackagePlan {
  status: "planned_unpublished";
  effective_date: "2026-07-29";
  image_count: 4;
  image_aspect_ratio: "4:5";
  companion_video_required: true;
  video_master_aspect_ratio: "9:16";
  instagram_delivery: "mixed-carousel-candidate";
  facebook_delivery: "paired-video-candidate";
  platform_preflight_required: true;
  publish_authorized: false;
  included_in_kpi: false;
}

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
  media_type?: MediaType;
  instagram_caption: string;
  facebook_caption: string;
  image_prompt: string;
  carousel_items?: CarouselItem[];
  video_prompt?: string;
  video_candidate?: VideoCandidatePlan;
  media_package?: CompanionMediaPackagePlan;
  visual_route: VisualRoute;
  traffic_route: TrafficRoute;
  content_role?: ContentRole;
  views_target?: number;
  follower_target?: number;
  follow_cta?: string;
  seo_sync_page?: string;
  search_intent?: SearchIntent;
  target_queries?: string[];
  evidence_type?: SearchEvidenceType;
  ten_day_review_metric?: string;
  content_plan_source?: "growth-playbook" | "legacy-template";
  local_image_path: string;
  public_image_url: string;
  local_video_path?: string;
  public_video_url?: string;
  status: PostStatus;
}

export interface CarouselItem {
  slide: number;
  image_prompt: string;
  local_image_path: string;
  public_image_url: string;
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

export interface VideoSourceRecord {
  date: string;
  slot: number;
  source: "grok-imagine-video";
  model: string;
  video_path: string;
  request_id: string;
  source_route?: "xai-api" | "grok-web-manual" | "hermes-xai-oauth";
  source_reference?: string;
  duration_seconds: number;
  width: number;
  height: number;
  frame_rate: number;
  video_codec: string;
  audio_codec?: string;
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
  published_media_type?: MediaType;
  video_status?: "published" | "VIDEO_DEFERRED" | "not_planned";
  video_defer_kind?: VideoDeferKind;
  video_deferred_reason?: string;
  /** Present only on dual-Reel A/B days that have an ab-test-plan entry. */
  ab_variant?: "10s" | "15s";
  post_id?: string;
  error?: string;
  created_at: string;
}

// "expected" is a video that is simply not ready: no path, no file, or a review,
// freshness or metadata gate that has not passed yet. "unexpected" is anything
// else, and means the fallback was caused by a fault rather than by a pending
// gate — without the distinction a broken build looks exactly like waiting.
export type VideoDeferKind = "expected" | "unexpected";

export interface VideoRepairQueueEntry {
  source_date: string;
  source_slot: number;
  status: "VIDEO_DEFERRED" | "RESOLVED";
  original_media_type: "reel" | "mixed-carousel";
  fallback_media_type: "image" | "carousel";
  defer_kind: VideoDeferKind;
  dry_run?: boolean;
  failure_reason: string;
  detected_at: string;
  next_attempt: "next-production-cycle";
  replacement_ready_at?: string;
  replacement_candidate_date?: string;
  replacement_candidate_slot?: number;
  resolved_at?: string;
  replacement_date?: string;
  replacement_slot?: number;
}

export interface AppConfig {
  dryRun: boolean;
  timezone: string;
  graphApiVersion: string;
  metaAccessToken?: string;
  metaAnalyticsAccessToken?: string;
  facebookPageId?: string;
  instagramLocationId?: string;
  instagramUserId?: string;
  publicSiteBaseUrl: string;
  publicImageBaseUrl: string;
  publicRootPagesRepo: string;
  verifyPublicImageUrl: boolean;
  grokReelsEnabled?: boolean;
  ga4MeasurementId?: string;
}

export interface PostInput {
  date: string;
  slot: number;
  caption: string;
  imageUrl: string;
  imageUrls?: string[];
  mediaType?: MediaType;
  videoUrl?: string;
}

export interface PostResult {
  platform: Platform;
  status: Exclude<PostStatus, "pending" | "missed">;
  dry_run: boolean;
  attempts: number;
  post_id?: string;
}
