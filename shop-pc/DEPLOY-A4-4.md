# A4-4 deploy (shop PC): no LINE webhook registration in the night window
1. Stop the running tunnel supervisor (task/window running runtime\tunnel_supervisor.py).
2. Back up C:\LaundryStores\fxwash\runtime\tunnel_supervisor.py and runtime\test_tunnel_events.py.
3. Copy the two files from shop-pc/fxwash/runtime/ into C:\LaundryStores\fxwash\runtime\.
4. Optional shop.json key (these are the defaults; read once at supervisor start):
   "handover": {"day_start": "10:00", "day_end": "20:00", "tz": "Asia/Taipei"}
5. From C:\LaundryStores\fxwash run: python -B -m unittest discover -s runtime -p test_*.py
6. Start the supervisor again. A single "handover ..." line is printed at startup.
Verify in logs\tunnel_events.jsonl:
- After 20:00, each new URL gives url_detected + skipped_night (put/verify "not_attempted"), no put_start.
- At 10:00 (within about 30 s), day_start_register, then put_start/put_result/verify_result "match".
Rollback: stop the supervisor, restore the two backed-up files, start it again
(the old code ignores the optional "handover" key).