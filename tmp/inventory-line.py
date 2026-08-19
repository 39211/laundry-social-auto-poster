import json
import os

root = r"C:\Users\cyc39\Documents\New project 5\data\content-calendar"
for d in ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"]:
    p = os.path.join(root, d + ".json")
    print("====", d, "exists", os.path.exists(p))
    if not os.path.exists(p):
        continue
    data = json.load(open(p, encoding="utf-8"))
    print("generated_at", data.get("generated_at"))
    for s in data.get("slots", []):
        ig = s.get("instagram_caption") or ""
        fb = s.get("facebook_caption") or ""
        topic = (s.get("topic") or "")[:40]
        print(f"  slot {s.get('slot')} format={s.get('format')} topic={topic}")
        print(
            "    IG line.html",
            "go/line.html" in ig,
            "source=post" in ig,
            "source=bio" in ig or "點個人檔案" in ig,
            "0968327653" in ig,
        )
        print(
            "    FB line.html",
            "go/line.html" in fb,
            "source=post" in fb,
            "source=bio" in fb or "點個人檔案" in fb,
            "0968327653" in fb,
        )
        print("    IG CTA tail:", ig[-220:])
        print("    FB CTA tail:", fb[-220:])
