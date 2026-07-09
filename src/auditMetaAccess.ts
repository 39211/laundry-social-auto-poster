import { getConfig } from "./config";
import { isMain } from "./cli";

interface GraphResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  error?: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  status?: number;
  error?: string;
  evidence?: Record<string, unknown>;
  required?: string[];
}

function tokenLooksUsable(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !/^(\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    trimmed
  );
}

async function graph(pathname: string, params: Record<string, string>, accessToken: string, version: string): Promise<GraphResult> {
  const url = new URL(`https://graph.facebook.com/${version}/${pathname.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }

  const error = body.error as { message?: string } | undefined;
  return {
    ok: response.ok && !error,
    status: response.status,
    body,
    error: error?.message
  };
}

function check(name: string, result: GraphResult, required: string[], evidence?: Record<string, unknown>): CheckResult {
  return {
    name,
    ok: result.ok,
    status: result.status,
    error: result.error,
    evidence,
    required: result.ok ? undefined : required
  };
}

function firstMediaId(result: GraphResult): string | undefined {
  const data = result.body.data;
  if (!Array.isArray(data)) return undefined;
  const first = data[0] as { id?: string } | undefined;
  return first?.id;
}

export async function auditMetaAccess(): Promise<{
  generated_at: string;
  graph_api_version: string;
  token_source: "META_ANALYTICS_ACCESS_TOKEN" | "META_ACCESS_TOKEN";
  checks: CheckResult[];
  recommended_actions: string[];
  references: Record<string, string>;
}> {
  const config = getConfig();
  const analyticsToken = config.metaAnalyticsAccessToken;
  const publishToken = config.metaAccessToken;
  const accessToken = tokenLooksUsable(analyticsToken) ? analyticsToken : publishToken;
  const tokenSource = tokenLooksUsable(analyticsToken) ? "META_ANALYTICS_ACCESS_TOKEN" : "META_ACCESS_TOKEN";

  if (!tokenLooksUsable(accessToken)) {
    throw new Error("Set META_ANALYTICS_ACCESS_TOKEN or META_ACCESS_TOKEN before auditing Meta analytics access.");
  }
  if (!config.facebookPageId) throw new Error("FB_PAGE_ID is required.");
  if (!config.instagramUserId) throw new Error("IG_USER_ID is required.");
  const graphAccessToken = accessToken!;
  const facebookPageId = config.facebookPageId!;
  const instagramUserId = config.instagramUserId!;

  const checks: CheckResult[] = [];

  const pageBasic = await graph(
    `${facebookPageId}`,
    { fields: "id,name,instagram_business_account" },
    graphAccessToken,
    config.graphApiVersion
  );
  checks.push(
    check("facebook_page_basic", pageBasic, ["pages_read_engagement"], {
      page_id: facebookPageId,
      instagram_business_account: (pageBasic.body.instagram_business_account as { id?: string } | undefined)?.id
    })
  );

  const igBasic = await graph(
    `${instagramUserId}`,
    { fields: "id,username,followers_count,media_count" },
    graphAccessToken,
    config.graphApiVersion
  );
  checks.push(
    check("instagram_business_basic", igBasic, ["instagram_business_basic"], {
      instagram_user_id: instagramUserId,
      username: igBasic.body.username,
      followers_count: igBasic.body.followers_count,
      media_count: igBasic.body.media_count
    })
  );

  const igMedia = await graph(
    `${instagramUserId}/media`,
    { limit: "5", fields: "id,timestamp,like_count,comments_count,permalink" },
    graphAccessToken,
    config.graphApiVersion
  );
  checks.push(
    check("instagram_media_basic_counts", igMedia, ["instagram_business_basic"], {
      sample_media_id: firstMediaId(igMedia),
      sample_count: Array.isArray(igMedia.body.data) ? igMedia.body.data.length : 0
    })
  );

  const mediaId = firstMediaId(igMedia);
  if (mediaId) {
    const igInsights = await graph(
      `${mediaId}/insights`,
      { metric: "reach,likes,comments,shares,saved,total_interactions" },
      graphAccessToken,
      config.graphApiVersion
    );
    checks.push(
      check("instagram_media_insights", igInsights, ["instagram_business_basic", "instagram_business_manage_insights"], {
        sample_media_id: mediaId
      })
    );
  }

  const pageInsights = await graph(
    `${facebookPageId}/insights`,
    { metric: "page_post_engagements", period: "day" },
    graphAccessToken,
    config.graphApiVersion
  );
  checks.push(
    check("facebook_page_insights", pageInsights, ["pages_read_engagement", "read_insights"], {
      page_id: facebookPageId
    })
  );

  const missing = new Set<string>();
  for (const item of checks) {
    if (!item.ok) item.required?.forEach((permission) => missing.add(permission));
  }

  const recommendedActions = [
    "Keep META_ACCESS_TOKEN for publishing so the live posting chain is not disrupted.",
    "Create a separate META_ANALYTICS_ACCESS_TOKEN with the missing analytics permissions, then rerun npm run audit-meta-access.",
    ...Array.from(missing).map((permission) => `Request or grant Meta permission: ${permission}`)
  ];

  return {
    generated_at: new Date().toISOString(),
    graph_api_version: config.graphApiVersion,
    token_source: tokenSource,
    checks,
    recommended_actions: recommendedActions,
    references: {
      instagram_media_insights:
        "https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights/",
      page_insights: "https://developers.facebook.com/docs/graph-api/reference/insights/",
      permissions: "https://developers.facebook.com/docs/permissions/",
      access_levels: "https://developers.facebook.com/docs/graph-api/overview/access-levels/"
    }
  };
}

if (isMain(import.meta.url)) {
  auditMetaAccess()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
