import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "daily_progress.py"
class DailyAlerts(unittest.TestCase):
    def test_lost_alert_and_notification_state_reach_the_daily_report(self):
        with tempfile.TemporaryDirectory(prefix="a74-report-") as folder:
            root=Path(folder); alerts=root/"output/alerts"; alerts.mkdir(parents=True)
            (alerts/"fb-lost-2026-09-21-slot1.json").write_text(json.dumps({"alert":"FB_LOST","date":"2026-09-21","slot":1}),encoding="utf-8")
            env=os.environ.copy(); env["DAILY_PROGRESS_ROOT"]=str(root)
            run=subprocess.run([sys.executable,"-B",str(SCRIPT),"2026-09-21"],env=env,capture_output=True,text=True,encoding="utf-8")
            self.assertEqual(run.returncode,0,run.stderr)
            report=(root/"reports/daily-progress.md").read_text(encoding="utf-8")
            self.assertIn("FB 2026-09-21 第 1 槽待人工核對",report)
            self.assertIn("店員通知尚未確認",report)
    def test_resolved_alert_is_not_reported_as_still_waiting(self):
        with tempfile.TemporaryDirectory(prefix="a74-resolved-") as folder:
            root=Path(folder); alerts=root/"output/alerts"; notices=alerts/"notifications"; notices.mkdir(parents=True)
            name="fb-lost-2026-09-21-slot1.json"
            (alerts/name).write_text(json.dumps({"alert":"FB_LOST","date":"2026-09-21","slot":1}),encoding="utf-8")
            (notices/name).write_text(json.dumps({"status":"resolved"}),encoding="utf-8")
            env=os.environ.copy(); env["DAILY_PROGRESS_ROOT"]=str(root)
            run=subprocess.run([sys.executable,"-B",str(SCRIPT),"2026-09-21"],env=env,capture_output=True,text=True,encoding="utf-8")
            self.assertEqual(run.returncode,0,run.stderr)
            report=(root/"reports/daily-progress.md").read_text(encoding="utf-8")
            self.assertIn("舊警報保留備查",report)
            self.assertNotIn("待人工核對",report)

if __name__=="__main__": unittest.main()
