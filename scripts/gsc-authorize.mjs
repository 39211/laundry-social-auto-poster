// One-time Search Console authorisation, modelled on scripts/ga4-authorize.mjs.
//
// WHY THIS EXISTS (2026-09-10). GSC_REFRESH_TOKEN dies roughly every seven days
// with `invalid_grant / Token has been expired or revoked`, and it has now taken
// the whole search-measurement chain down twice: 2026-08-29 and again from
// 2026-09-06, five nights in a row. GA4 and YouTube on this machine never expire.
//
// The difference is the OAuth client, not the API. GSC_CLIENT_ID belongs to
// Cloud project 263073074704; YT_CLIENT_ID belongs to 719432603364. A refresh
// token issued by an app still in "Testing" on its consent screen expires after
// seven days — that is Google's published behaviour, and it exactly matches the
// observed cadence. The YouTube client does not do this, so it is published.
//
// So this script deliberately does NOT re-authorise the broken client. It asks
// the working, published client for one extra scope, the same trick ga4-authorize
// already uses. Fixing the symptom (re-consenting 263073074704 every Monday) was
// the 2026-08-29 approach and it bought six days.
//
// PREREQUISITE, and the one thing that can still fail: the Search Console API
// must be enabled on project 719432603364. If it is not, the consent will
// succeed and the first API call will return
//   403 "Google Search Console API has not been used in project 719432603364"
// with a link that enables it. Enabling takes one click and then a minute.
//
// Run:  node scripts/gsc-authorize.mjs
// Prints a URL, waits for the localhost redirect, exchanges the code, prints the
// line to paste into .env. Nothing is written to disk automatically.

import { createServer } from "node:http";
import { config } from "dotenv";

config();

// --legacy uses the ORIGINAL GSC client from Cloud project 263073074704. That
// project's consent screen is still "Testing", so its refresh tokens die after
// seven days -- but its Search Console API IS enabled, which the published
// project's is not. So --legacy is the recover-the-data-tonight path and the
// default is the permanent one. Neither is a substitute for the other until
// somebody enables searchconsole.googleapis.com on 719432603364.
const legacy = process.argv.includes("--legacy");
const CLIENT_ID = legacy ? process.env.GSC_CLIENT_ID : process.env.YT_CLIENT_ID;
const CLIENT_SECRET = legacy ? process.env.GSC_CLIENT_SECRET : process.env.YT_CLIENT_SECRET;
const PORT = legacy ? 8733 : 8732;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
// searchAnalytics/query and urlInspection/index:inspect are both reads.
// Deliberately not requesting the read-write `webmasters` scope: nothing in this
// repo submits sitemaps through the API, and a narrower scope is less likely to
// trip Google's verification requirements on a published client.
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    legacy
      ? "GSC_CLIENT_ID / GSC_CLIENT_SECRET 不在 .env 裡。"
      : "YT_CLIENT_ID / YT_CLIENT_SECRET 不在 .env 裡,先確認 YouTube 那組憑證還在。"
  );
  process.exit(1);
}
console.log(
  legacy
    ? "\n模式:--legacy(舊 client / 專案 263073074704)。API 有開,但 token 約七天後會再過期。\n"
    : "\n模式:預設(已發布的 client / 專案 719432603364)。token 不會過期,但要先啟用該專案的 Search Console API。\n"
);

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Without this Google returns no refresh token when re-consenting a client
    // that this account has already authorised -- which is exactly our case.
    prompt: "consent"
  });

console.log("\n步驟 1/3　用『擁有 sixiangjialaundry.com 這個 Search Console 資源的那個 Google 帳號』");
console.log("打開下面這個網址,按同意:\n");
console.log(authUrl);
console.log("\n(如果 Google 說 redirect_uri 不符,到 Cloud Console 專案 719432603364 的 OAuth 用戶端,");
console.log(` 把 ${REDIRECT} 加進「已授權的重新導向 URI」,存檔後再跑一次。)\n`);
console.log("步驟 2/3　同意後瀏覽器會跳回本機,這個視窗會自己收到授權碼…\n");

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
      (code ? "授權完成,回到終端機看下一步。" : `授權失敗:${error ?? "沒有拿到授權碼"}`) +
      `</body>`
  );
  server.close();

  if (!code) {
    console.error(`\n授權失敗:${error ?? "沒有拿到授權碼"}`);
    process.exit(1);
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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
  const payload = await tokenResponse.json();
  if (!payload.refresh_token) {
    console.error(
      `\n沒有拿到 refresh token:${payload.error_description ?? payload.error ?? "未知原因"}` +
        `\n(通常是這個帳號先前已授權過而 Google 沒再發;本腳本已帶 prompt=consent,` +
        `\n 若仍失敗,到 myaccount.google.com/permissions 移除這個應用的存取權後重跑。)`
    );
    process.exit(1);
  }

  // Smoke-test the new token against the real API before telling anyone it works.
  // A refresh token that cannot call Search Console is not a fix, and this is the
  // exact call that has been failing every night.
  let verdict = "未驗證";
  try {
    const accessResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: payload.refresh_token,
        grant_type: "refresh_token"
      })
    });
    const access = await accessResponse.json();
    if (!access.access_token) {
      verdict = `換 access token 失敗:${access.error_description ?? access.error}`;
    } else {
      const site = process.env.GSC_SITE_URL ?? "sc-domain:sixiangjialaundry.com";
      const probe = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}`,
        { headers: { Authorization: `Bearer ${access.access_token}` } }
      );
      const body = await probe.json().catch(() => ({}));
      if (probe.ok) {
        verdict = `OK — ${site} 讀得到,權限 ${body.permissionLevel ?? "(未回報)"}`;
      } else if (JSON.stringify(body).includes("has not been used in project")) {
        verdict =
          "Search Console API 還沒在專案 719432603364 啟用。錯誤訊息裡有一個啟用連結,點下去、等一分鐘、再跑一次這個腳本的驗證。";
      } else {
        verdict = `HTTP ${probe.status} ${JSON.stringify(body).slice(0, 300)}`;
      }
    }
  } catch (err) {
    verdict = `驗證時丟例外:${err.message}`;
  }

  console.log("步驟 3/3　把下面這一行貼進 .env,取代原本那行 GSC_REFRESH_TOKEN:\n");
  console.log(`GSC_REFRESH_TOKEN=${payload.refresh_token}\n`);
  console.log(`即時驗證結果:${verdict}\n`);
  console.log("貼好之後跑這兩個確認整條鏈活了:");
  console.log("  npm run gsc-search-analytics");
  console.log("  npm run gsc-index-inspect\n");
  console.log("注意:GSC_CLIENT_ID / GSC_CLIENT_SECRET 兩行留著不要動,它們現在沒人用,");
  console.log("但刪掉會讓之後查『當初為什麼換 client』沒有線索。\n");
});

server.listen(PORT);
