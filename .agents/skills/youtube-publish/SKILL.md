---
name: youtube-publish
description: Publish the day's live Reel to the shop's YouTube channel as a Short, by API when authorized or by browser when a human session is available.
---

# YouTube Publish Skill

The owner's channel: `https://studio.youtube.com/channel/UCcVDFN7Ve-cD9duxRdM5VXQ`
(私享家洗衣店). Every Reel that live-publishes on Instagram also goes to YouTube
as a Short. YouTube is a secondary surface: nothing here may block, delay, or
modify the FB/IG chain the 90-day programme is measured on.

## What gets uploaded

- Only slot 2 Reels whose posted-log entry shows `platform: instagram`,
  `published_media_type: reel`, live (`dry_run` absent/false, status
  `success` or `posted`). A day whose video deferred to images uploads nothing.
- The file is `docs/assets/<date>/slot-02.mp4` — the exact file that published,
  never a rebuilt variant.
- One upload per date+slot. `data/youtube-log/<date>.json` is the idempotency
  record; check it before uploading, write it after.

## Metadata (both routes use exactly this)

- Title: the slot's `topic` (the hook), truncated to 88 chars, then ` #Shorts`.
- Description: first three blocks of the Instagram caption, then
  `台中市區免費到府收送｜私享家洗衣店`, then `#Shorts #台中洗衣店 #洗鞋 #洗包`.
- Language zh-Hant. Category: People & Blogs (22). Not made for kids.
- **Altered/synthetic content: YES.** The clips are generated; the account
  declares it, the same honesty the image pipeline keeps with C2PA. Never
  uncheck this to dodge the label.
- Visibility: Public. No premiere, no schedule — the Reel already premiered on
  Instagram at 19:35.

## Route A — API (the scheduled, hands-free route)

`Laundry-YouTube-Upload` runs `scripts/youtube-upload.ps1` at 20:00 and 21:50
daily; it calls `npm run post-youtube -- --date <today> --slot 2`
(`src/postYouTube.ts`). Requires `YT_CLIENT_ID`, `YT_CLIENT_SECRET`,
`YT_REFRESH_TOKEN` in `.env`.

- One-time setup by the owner only: `npm run youtube-auth` (loopback OAuth;
  the refresh token is written straight into `.env` and never printed).
- Until authorized, uploads skip with a toast reminder. That is the designed
  state, not a fault. Never work around missing credentials by any other
  means, and never print or copy token values anywhere.

## Route B — browser (fallback when a human session exists)

Used when the API is not yet authorized and an agent has access to a browser
where the owner is already signed in (e.g. Claude via the Chrome extension).
Codex must not attempt this route: driving the owner's signed-in browser
session is only done by an agent the owner is actively supervising.

1. Open `https://studio.youtube.com` → 建立 → 上傳影片.
2. Upload `docs/assets/<date>/slot-02.mp4` via the file input (never the native
   picker dialog).
3. Fill the metadata above. In 詳細資訊 → 顯示更多 → 變造內容, answer 是 (yes,
   synthetic/altered content).
4. 目標觀眾: 不是為兒童打造. Visibility 公開 → 發布.
5. Record the resulting video id in `data/youtube-log/<date>.json` with the
   same shape route A writes: `{date, slot, video_id, title, uploaded_at}`.

## Rules

- Upload after Instagram, never before: YouTube must not scoop the primary
  channel.
- A failed upload is retried at the 21:50 window and then left with a toast;
  do not retry a third time the same night.
- Never delete or re-upload an already-published Short to "fix" metadata;
  edit metadata in place through Studio instead.
- The owner reviews published Shorts the same as Reels: feedback feeds the
  next day's production, not retroactive edits.
