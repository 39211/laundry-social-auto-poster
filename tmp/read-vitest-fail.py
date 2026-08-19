import json

data = json.load(open(r"C:\Users\cyc39\Documents\New project 5\tmp\vitest-full.json", encoding="utf-8"))
print("numFailedTests", data.get("numFailedTests"))
print("numPassedTests", data.get("numPassedTests"))
print("numTotalTests", data.get("numTotalTests"))
print("success", data.get("success"))
for tf in data.get("testResults", data.get("testResults", [])):
    pass
# vitest json shape
files = data.get("testResults") or data.get("results") or []
if not files and "testResults" not in data:
    print("keys", list(data.keys())[:30])

# try common shapes
if isinstance(data.get("testResults"), list):
    for tf in data["testResults"]:
        name = tf.get("name") or tf.get("assertionResults")
        assertions = tf.get("assertionResults") or []
        failed = [a for a in assertions if a.get("status") == "failed"]
        if failed or tf.get("status") == "failed":
            print("FILE", tf.get("name"))
            for a in failed:
                print("  FAIL", a.get("fullName") or a.get("title"))
                msgs = a.get("failureMessages") or []
                for m in msgs[:1]:
                    print("   ", m.splitlines()[0][:300])
elif isinstance(data.get("files"), list):
    for tf in data["files"]:
        if tf.get("result") == "fail" or (tf.get("nbFail") or 0) > 0:
            print("FILE", tf.get("filepath") or tf.get("name"))
            for t in tf.get("tasks") or []:
                print(" task", t.get("name"), t.get("result", {}).get("state"))
