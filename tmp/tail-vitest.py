from pathlib import Path
p = Path(r"C:\Users\cyc39\Documents\New project 5\tmp\vitest-final.txt")
text = p.read_text(encoding="utf-8", errors="replace")
lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
print("TOTAL_NONEMPTY", len(lines))
print("---- LAST 12 ----")
for ln in lines[-12:]:
    print(ln)
