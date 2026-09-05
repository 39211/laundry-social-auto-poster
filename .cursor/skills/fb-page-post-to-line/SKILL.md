---
name: fb-page-post-to-line
description: >-
  use when watching FB Page or Messenger for new posts/chats, capturing one
  complete card (no boost bar, no split), hosting, and LINE push with
  fingerprint detect
---
# FB Page / Messenger → single card → LINE

Use when watching a Facebook **Page** feed or **Messenger / Page Inbox** for new activity, capturing screenshots to the locked quality bar, hosting publicly, and pushing to a LINE group.

## Locked quality bar (user-confirmed)
- **One single image** per post/thread alert: full expanded copy + complete media in one card.
- **Never** split text and photos into two LINE images.
- Crop out **加強推廣 / Boost** rows and other admin chrome when present.
- No large empty pad, no sidebars, no page cover.
- Label by real topic meaning — do not mis-title from a metaphor in the first line.

## Detection (do not guess wall-clock)
1. Keep a baseline fingerprint file.
2. Page posts: fingerprint = first line (~80 chars) of the newest **page-owner** post after expanding「查看更多」.
3. Messenger: fingerprint = thread id/title + latest inbound preview/time (or unread badge change + top inbox row hash). Prefer Facebook Messages while identity is the Page when Business Inbox is unavailable.
4. Same fingerprint → **stay quiet** (no user ping).
5. Optional upgrade: Meta Page webhooks / Graph subscriptions when a Page access token exists. Until then, poll unread/inbox/feed on a schedule as the working notify path.

## Capture rules
1. Expand full text; record `textLen`.
2. Scroll/open media until **all** images/video frames needed for the card are complete.
3. If viewport cannot fit: zoom/scroll/compose into **one** stitched card before publish — still one deliverable image.
4. Messenger: crop **the other party’s talk** (and needed context bubbles). Do not crop the whole browser; ignore unrelated threads.
5. Never like, comment, react, boost, or send messages.

## Publish path
1. JPEG (+ preview ≤1MB-friendly).
2. Host on the configured public GitHub raw/Pages path (`39211/line-media`).
3. **HEAD** both URLs must be 200 `image/*` before LINE push.
4. Push text summary + **one** image to the configured LINE group.
5. Notify the user with the card + HTTP status; update baseline.
6. Loop-guard: no identical successful re-push; after 2 identical step failures, stop and report.

## Standing auth note
Routines may push to the **saved LINE test group** only when the user has authorized that path. Other groups / spend / login still need an explicit ask.

## Evidence for PASS
New fingerprint written; single-card file exists without boost bar / empty pad; HEAD 200; LINE HTTP status recorded.
