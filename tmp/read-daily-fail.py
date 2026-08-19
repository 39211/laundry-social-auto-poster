import json

data = json.load(open(r"C:\Users\cyc39\Documents\New project 5\tmp\vitest-full.json", encoding="utf-8"))
for tf in data.get("testResults", []):
    if "dailyContent" not in (tf.get("name") or ""):
        continue
    for a in tf.get("assertionResults") or []:
        if a.get("status") != "failed":
            continue
        print("FAIL", a.get("fullName"))
        for m in a.get("failureMessages") or []:
            print(m[:4000])
            print("---")
