import { readFile } from "node:fs/promises";
import { join } from "node:path";
import "./config";
import { projectRoot } from "./paths";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GBP_OAUTH_CLIENT_RELATIVE = "secrets/gbp-oauth-client.json";

export type GbpAuthErrorKind = "rate_limited" | "unauthorized" | "refresh_failed" | "not_configured";

export class GbpAuthError extends Error {
  readonly kind: GbpAuthErrorKind;
  readonly status?: number;

  constructor(message: string, kind: GbpAuthErrorKind, status?: number) {
    super(redactSecrets(message));
    this.name = "GbpAuthError";
    this.kind = kind;
    this.status = status;
  }
}

export interface GbpOAuthClient {
  client_id: string;
  client_secret: string;
}

export interface GbpEnvIds {
  refreshToken: string;
  locationId: string;
  accountId: string;
}

function redactSecrets(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._~\-]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9._~\-]+/g, "[redacted]")
    .replace(/access_token\s*[:=]\s*["']?[^,\s"']+/gi, "access_token=[redacted]")
    .replace(/refresh_token\s*[:=]\s*["']?[^,\s"']+/gi, "refresh_token=[redacted]")
    .replace(/client_secret\s*[:=]\s*["']?[^,\s"']+/gi, "client_secret=[redacted]");
}

function usable(value: string | undefined): string {
  return value?.trim() ?? "";
}

function classifyStatus(status: number): Exclude<GbpAuthErrorKind, "not_configured"> {
  if (status === 429) return "rate_limited";
  if (status === 401) return "unauthorized";
  return "refresh_failed";
}

function publicErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== "object") return `HTTP ${status}`;
  const record = payload as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : undefined;
  const message = [record.error_description, record.error, nested?.message, nested?.status]
    .find((value) => typeof value === "string" && value.trim() && value !== "invalid_grant");
  const errorCode = typeof record.error === "string" ? record.error : nested?.status;
  const bits = [typeof errorCode === "string" ? errorCode : undefined, typeof message === "string" ? message : undefined]
    .filter((value): value is string => Boolean(value));
  return bits.length > 0 ? bits.join(": ") : `HTTP ${status}`;
}

export function gbpOAuthClientPath(root = projectRoot()): string {
  return join(root, ...GBP_OAUTH_CLIENT_RELATIVE.split("/"));
}

export async function loadGbpOAuthClient(root = projectRoot()): Promise<GbpOAuthClient> {
  const filePath = gbpOAuthClientPath(root);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GbpAuthError(
        `GBP OAuth client JSON is missing at ${GBP_OAUTH_CLIENT_RELATIVE}`,
        "not_configured"
      );
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new GbpAuthError("GBP OAuth client JSON is not valid JSON", "not_configured");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new GbpAuthError("GBP OAuth client JSON is missing client_id/client_secret", "not_configured");
  }

  const record = parsed as Record<string, unknown>;
  const nested =
    record.installed && typeof record.installed === "object"
      ? (record.installed as Record<string, unknown>)
      : record.web && typeof record.web === "object"
        ? (record.web as Record<string, unknown>)
        : record;
  const client_id = usable(typeof nested.client_id === "string" ? nested.client_id : undefined);
  const client_secret = usable(typeof nested.client_secret === "string" ? nested.client_secret : undefined);
  if (!client_id || !client_secret) {
    throw new GbpAuthError("GBP OAuth client JSON is missing client_id/client_secret", "not_configured");
  }
  return { client_id, client_secret };
}

export function readGbpEnvIds(env: NodeJS.ProcessEnv = process.env): GbpEnvIds {
  return {
    refreshToken: usable(env.GBP_REFRESH_TOKEN),
    locationId: usable(env.GBP_LOCATION_ID),
    accountId: usable(env.GBP_ACCOUNT_ID)
  };
}

export function requireGbpAccountId(env: NodeJS.ProcessEnv = process.env): string {
  const accountId = readGbpEnvIds(env).accountId;
  if (!accountId) {
    throw new GbpAuthError(
      "GBP_ACCOUNT_ID is missing; refuse to publish. Set it explicitly — do not guess from GBP_LOCATION_ID.",
      "not_configured"
    );
  }
  return accountId;
}

export async function refreshGbpAccessToken(options: {
  env?: NodeJS.ProcessEnv;
  root?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const root = options.root ?? projectRoot();
  const fetchImpl = options.fetchImpl ?? fetch;
  const { refreshToken } = readGbpEnvIds(env);
  if (!refreshToken) {
    throw new GbpAuthError("GBP_REFRESH_TOKEN is missing", "not_configured");
  }

  const client = await loadGbpOAuthClient(root);
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const accessToken = typeof record.access_token === "string" ? record.access_token.trim() : "";
  if (!response.ok || !accessToken) {
    const status = response.status || 0;
    const kind = status === 0 ? "refresh_failed" : classifyStatus(status);
    throw new GbpAuthError(
      `GBP token refresh failed (${kind}): ${publicErrorMessage(payload, status)}`,
      kind,
      status || undefined
    );
  }
  return accessToken;
}
