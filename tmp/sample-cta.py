from pathlib import Path
import subprocess
import sys

# Use node/tsx via a tiny script file to avoid PowerShell quoting
script = r"""
import { getConfig } from "./src/config.ts";
import { buildDailyContent, linePostRedirectUrl } from "./src/contentPlan.ts";
import { captionsFor } from "./src/scheduleReel.ts";

const config = getConfig();
const date = "2026-08-18";
const content = buildDailyContent(date, config);
const slot = content.slots.find((s) => s.slot === 1)!;
const blocks = slot.facebook_caption.split("\n\n");
const hashIdx = blocks.findIndex((b) => b.startsWith("#"));
const cta = hashIdx === -1 ? blocks.slice(-3) : blocks.slice(Math.max(0, hashIdx - 3), hashIdx + 1);
console.log("LINE_POST=" + linePostRedirectUrl());
console.log("SLOT1_FB_CTA_BEGIN");
console.log(cta.join("\n\n"));
console.log("SLOT1_FB_CTA_END");
console.log("SLOT1_IG_HAS_URL=" + slot.instagram_caption.includes(linePostRedirectUrl()));
"""
Path(r"C:\Users\cyc39\Documents\New project 5\tmp\sample-cta.mts").write_text(script, encoding="utf-8")
