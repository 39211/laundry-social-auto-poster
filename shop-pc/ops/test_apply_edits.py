import subprocess, sys, tempfile, pathlib
tool = str(pathlib.Path(__file__).with_name("apply_edits.py"))
with tempfile.TemporaryDirectory() as d:
    d = pathlib.Path(d)
    (d / "a.txt").write_bytes("\ufeff第一行\r\n要改的行\r\n重複\r\n重複\r\n".encode("utf-8"))
    ok = d / "ok.md"
    ok.write_text("=== EDIT: a.txt ===\n<<<<<<< OLD\n要改的行\n=======\n改好了\n>>>>>>> NEW\n\n=== FILE: new/b.py ===\n```python\nprint('x')\n```\n", encoding="utf-8")
    r = subprocess.run([sys.executable, tool, str(ok), str(d)], capture_output=True, text=True)
    raw = (d / "a.txt").read_bytes()
    assert r.returncode == 0, r.stdout
    assert raw.startswith(b"\xef\xbb\xbf") and "改好了\r\n".encode() in raw and b"\n\n" not in raw, raw
    assert (d / "new" / "b.py").read_text() == "print('x')\n"
    bad = d / "bad.md"
    bad.write_text("=== EDIT: a.txt ===\n<<<<<<< OLD\n第一行\n=======\nX\n>>>>>>> NEW\n<<<<<<< OLD\n重複\n=======\nY\n>>>>>>> NEW\n", encoding="utf-8")
    before = (d / "a.txt").read_bytes()
    r = subprocess.run([sys.executable, tool, str(bad), str(d)], capture_output=True, text=True)
    assert r.returncode == 1 and "matches 2 times" in r.stdout, r.stdout
    assert (d / "a.txt").read_bytes() == before, "must write nothing on error"
    r = subprocess.run([sys.executable, tool, str(ok), str(d), "--dry-run"], capture_output=True, text=True)
    assert r.returncode == 1, "second apply: OLD gone -> error"
print("apply_edits self-test OK")
