// One-time GA4 authorisation. Reuses the OAuth client that already uploads to
// YouTube, so the owner grants one extra scope instead of creating a service
// account and sharing the property with it. Writes a SEPARATE refresh token:
// re-consenting for analytics must never be able to break the upload path.
//
// Run:  node scripts/ga4-authorize.mjs
// It prints a URL, waits for the redirect on localhost, exchanges the code and
// prints the two lines to paste into .env. Nothing is written automatically --
// the owner sees the values before they land on disk.

import { createServer } from "node:http";
import { config } from "dotenv";

config();

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const PORT = 8731;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("YT_CLIENT_ID / YT_CLIENT_SECRET 不在 .env 裡,先確認 YouTube 那組憑證還在。");
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
    // Without this Google returns no refresh token on a re-consent for a
    // client that has been authorised before -- which is exactly our case.
    prompt: "consent"
  });

console.log("\n步驟 1/3　用『管理這個 GA4 資源的那個 Google 帳號』打開下面這個網址,按同意:\n");
console.log(authUrl);
console.log("\n(如果 Google 說 redirect_uri 不符,到 Cloud Console 的 OAuth 用戶端把");
console.log(` ${REDIRECT} 加進「已授權的重新導向 URI」,存檔後再跑一次。)\n`);
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

  console.log("步驟 3/3　把下面兩行貼進 .env(GA4_PROPERTY_ID 填你 GA4 後台的『資源 ID』數字):\n");
  console.log(`GA4_REFRESH_TOKEN=${payload.refresh_token}`);
  console.log(`GA4_PROPERTY_ID=在這裡填數字\n`);
  console.log("資源 ID 位置:GA4 → 管理 → 資源設定 → 資源詳細資料,是一串純數字(不是 G- 開頭那個)。");
  console.log("貼好之後跑:  npm run ga4-report -- --date " + new Date().toISOString().slice(0, 10) + "\n");
});

server.listen(PORT);
