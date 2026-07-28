import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";

// Facebook publishing and Page insights both need a Page Access Token, but the
// Graph API Explorer hands out a short-lived User Access Token by default.
// This reads that user token from META_USER_TOKEN (falling back to
// META_ACCESS_TOKEN), exchanges it for a long-lived one when FB_APP_ID and
// FB_APP_SECRET are set, then derives the Page token and writes it back.
// A Page token derived from a long-lived user token never expires.
// Token values are never printed or returned.

const REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_read_user_content",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights"
];

interface GraphResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  error?: string;
}

async function graph(
  pathname: string,
  params: Record<string, string>,
  accessToken: string,
  version: string
): Promise<GraphResult> {
  const url = new URL(`https://graph.facebook.com/${version}/${pathname.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }

  const error = body.error as { message?: string } | undefined;
  return { ok: response.ok && !error, status: response.status, body, error: error?.message };
}

function readEnvValue(envText: string, name: string): string | undefined {
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && match[1] === name) return (match[2] ?? "").trim();
  }
  return undefined;
}

function setEnvValue(envText: string, name: string, value: string): string {
  const lines = envText.split(/\r?\n/);
  let replaced = false;

  const next = lines.map((line) => {
    const match = /^\s*([A-Za-z0-9_]+)\s*=/.exec(line);
    if (match && match[1] === name) {
      replaced = true;
      return `${name}=${value}`;
    }
    return line;
  });

  if (!replaced) next.push(`${name}=${value}`);
  return next.join("\n");
}

function grantedScopes(result: GraphResult): Set<string> {
  const data = result.body.data;
  if (!Array.isArray(data)) return new Set();
  return new Set(
    data
      .filter((item): item is { permission: string; status: string } => {
        const row = item as { permission?: unknown; status?: unknown };
        return typeof row.permission === "string" && row.status === "granted";
      })
      .map((item) => item.permission)
  );
}

function missingScopes(granted: Set<string>): string[] {
  // This workflow derives a Facebook Page Access Token and calls the
  // Instagram API with Facebook Login. The similarly named
  // instagram_business_* permissions belong to Instagram Login and use a
  // different token flow, so they cannot satisfy these requirements.
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

async function exchangeForLongLivedToken(
  shortToken: string,
  appId: string,
  appSecret: string,
  version: string
): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const response = await fetch(url.toString());
  const body = (await response.json()) as { access_token?: string; error?: { message?: string } };
  if (!response.ok || body.error || !body.access_token) {
    throw new Error(
      `Could not exchange for a long-lived user token (${response.status}): ${
        body.error?.message ?? "no access_token returned"
      }. Check FB_APP_ID and FB_APP_SECRET.`
    );
  }
  return body.access_token;
}

async function describeExpiry(token: string, version: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${version}/debug_token`);
  url.searchParams.set("input_token", token);
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as { data?: { expires_at?: number } };
  const expiresAt = body.data?.expires_at;
  if (expiresAt === 0) return "never";
  if (!expiresAt) return "unknown";
  return new Date(expiresAt * 1000).toISOString();
}

export interface RepairMetaTokenResult {
  page_token_written: boolean;
  page_name?: string;
  page_token_expires: string;
  long_lived_exchange: boolean;
  missing_scopes: string[];
  backup_path?: string;
  notes: string[];
}

export async function repairMetaToken(root = projectRoot()): Promise<RepairMetaTokenResult> {
  const config = getConfig();
  if (!config.facebookPageId) throw new Error("FB_PAGE_ID is required in .env.");

  const envPath = join(root, ".env");
  const envText = await readFile(envPath, "utf8");
  const suppliedToken = readEnvValue(envText, "META_USER_TOKEN") || readEnvValue(envText, "META_ACCESS_TOKEN");
  if (!suppliedToken) throw new Error("Set META_USER_TOKEN in .env to a fresh User Access Token first.");

  const notes: string[] = [];
  const version = config.graphApiVersion;

  const appId = readEnvValue(envText, "FB_APP_ID");
  const appSecret = readEnvValue(envText, "FB_APP_SECRET");
  let currentToken = suppliedToken;
  let longLivedExchange = false;

  if (appId && appSecret) {
    currentToken = await exchangeForLongLivedToken(suppliedToken, appId, appSecret, version);
    longLivedExchange = true;
  } else {
    notes.push(
      "FB_APP_ID and FB_APP_SECRET are not set, so the user token could not be extended. The resulting Page token will expire with it."
    );
  }

  const permissions = await graph("me/permissions", {}, currentToken, version);
  if (!permissions.ok) {
    throw new Error(
      `Could not read granted permissions (${permissions.status}): ${permissions.error ?? "unknown error"}. ` +
        "The token in META_ACCESS_TOKEN is expired or is not a User Access Token. Generate a fresh User token in the Graph API Explorer first."
    );
  }

  const missing = missingScopes(grantedScopes(permissions));

  const accounts = await graph("me/accounts", { fields: "id,name,access_token" }, currentToken, version);
  if (!accounts.ok) {
    throw new Error(
      `Could not list managed Pages (${accounts.status}): ${accounts.error ?? "unknown error"}. ` +
        "The pages_show_list permission is required."
    );
  }

  const pages = Array.isArray(accounts.body.data) ? accounts.body.data : [];
  const page = pages.find((item) => (item as { id?: string }).id === config.facebookPageId) as
    | { id: string; name?: string; access_token?: string }
    | undefined;

  if (!page) {
    throw new Error(
      `This token does not manage Page ${config.facebookPageId}. Pages it can reach: ${
        pages.map((item) => (item as { id?: string }).id).join(", ") || "(none)"
      }`
    );
  }
  if (!page.access_token) {
    throw new Error(`Page ${page.name ?? page.id} returned no access_token. Re-grant pages_show_list and try again.`);
  }

  const backupPath = `${envPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(envPath, backupPath);

  // The user token is routinely pasted straight into META_ACCESS_TOKEN, which the
  // next line would overwrite. Keep it so a later run can still extend it.
  let nextEnv = setEnvValue(envText, "META_USER_TOKEN", suppliedToken);
  nextEnv = setEnvValue(nextEnv, "META_ACCESS_TOKEN", page.access_token);
  nextEnv = setEnvValue(nextEnv, "META_ANALYTICS_ACCESS_TOKEN", page.access_token);
  await writeFile(envPath, nextEnv, "utf8");

  const pageTokenExpires = await describeExpiry(page.access_token, version);

  notes.push("META_ACCESS_TOKEN now holds the Page Access Token for publishing.");
  notes.push("META_ANALYTICS_ACCESS_TOKEN was set to the same Page token for insight reads.");
  if (pageTokenExpires !== "never") {
    notes.push(`This Page token still expires at ${pageTokenExpires}. Set FB_APP_ID and FB_APP_SECRET, then run this command again to make it permanent.`);
  }
  if (missing.length > 0) {
    notes.push(
      "Some required permissions are still not granted. Re-generate the User token with the missing scopes, then run this command again."
    );
  }

  return {
    page_token_written: true,
    page_name: page.name,
    page_token_expires: pageTokenExpires,
    long_lived_exchange: longLivedExchange,
    missing_scopes: missing,
    backup_path: backupPath,
    notes
  };
}

async function main(): Promise<void> {
  const result = await repairMetaToken();
  console.log(JSON.stringify(result, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
