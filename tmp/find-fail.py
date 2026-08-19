from pathlib import Path

roots = [
    Path(r"C:\Users\cyc39\.grok\sessions"),
    Path(r"C:\Users\cyc39\Documents\New project 5\tmp"),
]
for root in roots:
    if not root.exists():
        print("missing", root)
        continue
    print("scan", root)
    for p in root.rglob("*.log"):
        if "720c057a" in p.name or "vitest" in p.name.lower():
            print("FOUND", p, p.stat().st_size)
            text = p.read_text(encoding="utf-8", errors="replace")
            for line in text.splitlines():
                if "FAIL " in line or "Test Files" in line or "Failed Tests" in line or "AssertionError" in line:
                    print(line[:300])
