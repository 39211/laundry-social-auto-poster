"""Runner cleanup must remove its own tree, preserve neighbours and reject reparse points."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

import run_a2b_tests as runner


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="cleanup-check-"))
        self.token = uuid.uuid4().hex
        self.owned = self.base / (".a2b-test-tmp-" + self.token)
        self.owned.mkdir()
        (self.owned / ".a2b-owner").write_text(self.token, encoding="ascii")
        self.neighbour = self.base / "neighbour"
        self.neighbour.mkdir()
        self.sentinel = self.neighbour / "keep.txt"
        self.sentinel.write_text("keep", encoding="ascii")

    def test_removes_owned_tree_and_preserves_neighbour(self):
        nested = self.owned / "nested"
        nested.mkdir()
        (nested / "file.txt").write_text("owned", encoding="ascii")
        runner._remove_tree(self.owned, self.token)
        self.assertFalse(self.owned.exists())
        self.assertEqual(self.sentinel.read_text(encoding="ascii"), "keep")

    def test_refuses_foreign_directory(self):
        with self.assertRaises(ValueError):
            runner._remove_tree(self.neighbour, self.token)
        self.assertEqual(self.sentinel.read_text(encoding="ascii"), "keep")
        self.assertTrue(self.owned.exists())

    def test_refuses_wrong_owner_marker(self):
        (self.owned / ".a2b-owner").write_text("another-run", encoding="ascii")
        with self.assertRaises(ValueError):
            runner._remove_tree(self.owned, self.token)
        self.assertTrue(self.owned.exists())

    def test_refuses_junction_without_touching_target(self):
        link = self.owned / "junction"
        result = subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(self.neighbour)],
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        try:
            self.assertTrue(link.is_junction())
            with self.assertRaises(ValueError):
                runner._remove_tree(self.owned, self.token)
            self.assertEqual(self.sentinel.read_text(encoding="ascii"), "keep")
        finally:
            # Owner rule: unlink a junction with rmdir, never recursive deletion.
            result = subprocess.run(["cmd.exe", "/c", "rmdir", str(link)], capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
