# SEO90 W12 verification record — 2026-09-22

- Pro verdicts: `GO_W12_PRODUCTION_PREFLIGHT`, then `PREFLIGHT_GO`.
- Isolated transport rehearsal: 2026-09-25 09:00 Asia/Taipei; one due article; six expected/emitted collections equal; source and local Pages mirror each gained one direct child commit; loopback/canonical/JSON-LD/sitemap passed; second run was `NOOP`; terminal `resume --intent` and `status` were zero-write.
- Production read-only preflight: system-clock `run --policy` returned `WAIT_DUE`; due set empty; source and remote refs stable; Pages main stable; pin/bundle/CNAME/sitemap/journal bytes stable; 11 checks passed; no formal deployment or social publication.
- Evidence JSON: `seo90-w12-mirror-rehearsal-20260922.json`, `seo90-w12-production-preflight-20260922.json`.
- Boundary: formal 9/25 release has not run. At due time use the real system clock and the trusted pin only; do not use `--test-now`, `rehearse`, direct generators, manual docs edits, or a second intent.
