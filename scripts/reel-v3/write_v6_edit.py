#!/usr/bin/env python3
"""Write the 30-second Cloudtilt edit (v6): the reference's order, our fastest takes.

The owner, 2026-09-17: "掌刷那顆重新生成,要跟參考片一樣快,而且原本參考片有30秒耶."
The reference runs 904 frames at 30 fps. It alternates tools the way a real wash
goes -- wetting, the big drum, long brush and narrow wheel back and forth, the
inside of the shoe, then palm brush and steam nozzle taking turns around the
upper, a fine brush in one opening, the dry-bench wipe, a flash of the dirty shoe
and the clean pair. This edit follows that order with 26 segments of about a
second each, so repetition is of a TOOL on a different part of the shoe, never
the same clip twice.

Speed rules, all measured with stroke_rate.py / region_motion.py on 2026-09-17:
  * palm-brush takes are played at 1.25x (24 fps source, one frame per 30 fps
    frame). They already scrub at 2.4-3.0 cycles a second natively, so 1.25x puts
    them at 3.0-3.4 against the reference's 3.0. 2.5x would be 6+ and read as
    fast-forward.
  * machine, long-brush, nozzle and inside shots are 2.5x with a two-frame
    shutter blend, as in v5.
  * the owner's own hands at the dry bench stay at 1.25x.

Rejected on 2026-09-17 and not used: every heel palm take (4 of them -- either
the brush lifted off toward the lens or the stroke was a single slow push);
act-s07 and act-s12, whose machine brushes stay crisp and do not turn.

Usage: write_v6_edit.py <out-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

CX = "codex-cloudtilt-20260916"
PR = "reel-cloudtilt-20260916/palm-regen/clips"
EX = "reel-cloudtilt-20260916/extend/clips"
RC = "reel-cloudtilt-20260916"

M14 = {"kind": "machine", "rate": 14, "level_db": -30}
M18 = {"kind": "machine", "rate": 18, "level_db": -31}
LONG = {"kind": "scrub", "rate": 1.2, "level_db": -27}
PALM = {"kind": "scrub", "rate": 6.5, "level_db": -30}
STEAM = {"kind": "steam", "level_db": -27}


def v(id_, src, start, frames, step, blend, zoom, cx, cy, foley, why):
    return {"id": id_, "source": src, "start": start, "frames": frames, "step": step,
            "blend": blend, "zoom": zoom, "center": [cx, cy], "foley": foley, "why": why}


SHOTS = [
    {"id": "01-flash-clean", "source": f"{RC}/s01-00p00.png", "still": True, "frames": 2,
     "why": "參考片開頭兩格成品閃現。"},
    v("02-wetting", f"{CX}/foam-v2.mp4", 8, 88, 1, 2, 2.05, 0.50, 0.24,
      {"kind": "water", "level_db": -26},
      "沖水。2.05 倍只取上半部,避開原片 52% 高度那條生成瑕疵。"),
    v("03-drum-a", f"{CX}/drum-v1.mp4", 8, 31, 2, 2, 1.8, 0.56, 0.33, M14, "滾筒第一次。"),
    v("04-long-a", f"{CX}/longbrush-v1.mp4", 43, 26, 2, 2, 1.7, 0.33, 0.42, LONG,
      "長柄刷第一次,從回程開始。"),
    v("05-narrow-a", f"{CX}/narrow-v2.mp4", 12, 29, 2, 2, 1.8, 0.68, 0.33, M18, "窄輪第一次。"),
    v("06-long-b", f"{EX}/act-s06-07p03-t1.mp4", 20, 29, 2, 2, 1.8, 0.60, 0.74, LONG,
      "長柄刷第二次。左上的滾筒刷毛根根分明、沒有真的在轉,畫面下移到 46% 以下把它切掉。"),
    v("07-narrow-b", f"{EX}/lift-narrowB-t1.mp4", 10, 31, 2, 2, 1.6, 0.62, 0.40, M18,
      "窄輪第二次,首幀取自 Codex 窄輪片段後段,輪子本來就在轉。"),
    v("08-inside-hand", f"{CX}/inside-v1.mp4", 10, 32, 2, 2, 2.0, 0.60, 0.62,
      {"kind": "scrub", "rate": 5, "level_db": -30}, "鞋內手刷。"),
    v("09-inside-axis", f"{EX}/act-s09-10p10-t1.mp4", 62, 28, 1, 2, 1.7, 0.50, 0.60,
      {"kind": "machine", "rate": 20, "level_db": -32},
      "鞋內固定軸。原片 1.1-2.2 秒泡沫像融化的白膠一大團,不像泡沫;改取 2.6 秒之後、泡沫正常的一段,1.25 倍速。"),
    v("10-long-c", f"{EX}/act-s10-11p03-t1.mp4", 22, 29, 2, 2, 1.5, 0.45, 0.55, LONG,
      "長柄刷第三次,內側中底一道往下的長刷(0.9 秒起)。"),
    v("11-drum-b", f"{EX}/lift-drumB-t1.mp4", 10, 30, 2, 2, 1.6, 0.55, 0.38, M14,
      "滾筒第二次,首幀取自 Codex 滾筒片段後段。"),
    v("12-narrow-c", f"{CX}/narrow-v1.mp4", 2, 30, 1, 2, 1.6, 0.62, 0.40, M18,
      "窄輪第三次。逐格看:輪子 1.43 秒前是旋轉殘影,1.71 秒開始清楚、2.0 秒已停。只取到第 32 格(1.33 秒),改 1.25 倍速。"),
    v("13-palm-fore", f"{PR}/palm-forefoot-t1.mp4", 2, 36, 1, 1, 2.0, 0.38, 0.45, PALM,
      "掌刷前掌,重生版。原速 2.65 c/s,1.25 倍後約 3.3(參考 3.0)。"),
    v("14-nozzle-a", f"{CX}/nozzle-v2.mp4", 6, 30, 2, 2, 1.8, 0.62, 0.40, STEAM, "噴嘴第一次。"),
    v("15-palm-side", f"{PR}/palm-side2-d2t1.mp4", 2, 32, 1, 1, 1.8, 0.45, 0.53, PALM,
      "掌刷側面(直立),重生版。原速 2.44 c/s、幅度 17.6%;推近切掉右上靜止滾筒。"),
    v("16-drum-c", f"{EX}/act-s11-12p00-t1.mp4", 10, 31, 2, 2, 1.5, 0.55, 0.35, M14,
      "滾筒第三次,外底。刷毛確認在轉。"),
    v("17-palm-rear", f"{PR}/palm-rear-d2t1.mp4", 2, 30, 1, 1, 2.0, 0.62, 0.60, PALM,
      "掌刷後側,重生版。原速 2.48 c/s;推近切掉左上靜止滾筒。"),
    v("18-nozzle-b", f"{CX}/nozzle-v1.mp4", 10, 30, 2, 2, 1.8, 0.62, 0.40, STEAM,
      "噴嘴第二次。Codex 退件原因(背景刷不轉、鞋底 R 形符號)用推近避開,需逐格確認。"),
    v("19-palm-fore-b", f"{CX}/palm-v1.mp4", 2, 31, 1, 1, 2.0, 0.45, 0.45, PALM,
      "掌刷前掌另一個角度。Codex 退件原因是背景滾筒後段停轉;推近切掉、只用前 33 格。原速 2.65-2.97 c/s。"),
    v("20-detail", f"{CX}/detail-v1.mp4", 8, 30, 1, 1, 2.0, 0.60, 0.62,
      {"kind": "tick", "rate": 5, "level_db": -33}, "細刷進單一孔洞。"),
    v("21-palm-side-b", f"{PR}/palm-side-d2t2.mp4", 2, 30, 1, 1, 2.0, 0.62, 0.57, PALM,
      "掌刷側面(橫放),重生版。原速 2.67 c/s。"),
    v("22-nozzle-c", f"{EX}/act-s21-25p07-t1.mp4", 10, 31, 2, 2, 1.6, 0.50, 0.55, STEAM,
      "噴嘴進鞋口。推近切掉右上靜止滾筒。"),
    v("23-wipe-a", f"{EX}/act-s22-26p10-t1.mp4", 6, 30, 1, 1, 1.12, 0.50, 0.50,
      {"kind": "cloth", "rate": 1.6, "level_db": -33}, "乾區擦拭第一段,圍裙私享家要完整。"),
    v("24-wipe-b", f"{CX}/wipe-v1.mp4", 0, 105, 1, 1, 1.12, 0.50, 0.44,
      {"kind": "cloth", "rate": 1.6, "level_db": -33}, "乾區擦拭、轉正、放下。"),
    {"id": "25-flash-dirty", "source": f"{RC}/canon-dirty.png", "still": True, "frames": 9,
     "why": "參考片結尾前的髒鞋回插,0.3 秒。"},
    {"id": "26-reveal", "source": f"{RC}/canon-clean.png", "still": True, "frames": 64,
     "push": 0.04, "why": "洗後成品,慢慢推近 4%(後製運鏡,不交給影片模型)。"},
]


def main() -> int:
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    v5 = json.loads(io.open(out.parent / "v4" / "edit.json", encoding="utf-8").read())
    total = sum(s["frames"] for s in SHOTS)
    edit = {
        "version": "claude-v6-30s",
        "why": ("老闆 2026-09-17:掌刷要跟參考片一樣快、片長要跟參考片一樣 30 秒。"
                "照參考片的工序順序排 26 段,每段約 1 秒;重複的是工具、刷的是不同部位,同一段素材不重播。"),
        "source_dir": "output",
        "source_fps": 24, "fps": 30, "width": 1080, "height": 1920,
        "narration": v5["narration"],
        "narration_at": round(total / 30 - 3.45, 2),
        "camera": v5["camera"],
        "shots": SHOTS,
    }
    io.open(out / "edit.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(edit, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(SHOTS)} shots, {total} frames = {total / 30:.3f} s (reference 904 = 30.133 s); "
          f"narration at {edit['narration_at']} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
