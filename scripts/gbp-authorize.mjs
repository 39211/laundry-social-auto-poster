// One-time GBP re-authorisation (mirrors ga4-authorize.mjs, per
// docs-internal/gbp-oauth-setup.md's own TODO). Uses the dedicated GBP OAuth
// client in secrets/gbp-oauth-client.json. Prints the GBP_REFRESH_TOKEN line
// to paste into .env; writes nothing automatically.
//
// Run:  node scripts/gbp-authorize.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("secrets/gbp-oauth-client.json", "utf8"));
const client = raw.installed ?? raw.web ?? raw;
const CLIENT_ID = client.client_id;
const CLIENT_SECRET = client.client_secret;
const PORT = 8732;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/business.manage";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("secrets/gbp-oauth-client.json 缺 client_id/client_secret");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent"
  });

console.log("\nAUTH_URL_BEGIN");
console.log(authUrl);
console.log("AUTH_URL_END\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<meta charset="utf8"><body style="font:16px/1.7 system-ui;padding:40px">` +
      (code ? "GBP 授權完成,可以關掉這個分頁。" : `授權失敗:${error ?? "沒有拿到授權碼"}`) +
      `</body>`
  );
  server.close();
  if (!code) process.exit(1);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code"
    })
  });
  const token = await tokenRes.json();
  if (!token.refresh_token) {
    console.error("沒有拿到 refresh_token:", JSON.stringify(token).slice(0, 200));
    process.exit(1);
  }
  console.log("REFRESH_TOKEN_BEGIN");
  console.log(token.refresh_token);
  console.log("REFRESH_TOKEN_END");
});

server.listen(PORT);
