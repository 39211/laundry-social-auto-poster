import json
data = json.load(open(r"C:\Users\cyc39\Documents\New project 5\tmp\vitest-full2.json", encoding="utf-8"))
print("numFailedTests", data.get("numFailedTests"))
print("numPassedTests", data.get("numPassedTests"))
print("numTotalTests", data.get("numTotalTests"))
print("success", data.get("success"))
print("startTime", data.get("startTime"))
# last 3 lines equivalent
print("Test Files", "passed" if data.get("success") else "failed")
