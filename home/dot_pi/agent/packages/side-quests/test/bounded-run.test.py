"""Exercise supervisor failure and quota cleanup using at most 65 fixture bytes."""

import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bounded_run", Path(__file__).with_name("bounded-run.py"))
bounded = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bounded)


class BoundedRunTests(unittest.TestCase):
    def run_fixture(self, body, limit=128 * 1024**2):
        output = io.StringIO()
        roots = []
        create = bounded.tempfile.mkdtemp

        def own_root(*args, **kwargs):
            result = create(*args, **kwargs)
            roots.append(Path(result))
            return result

        with (
            patch.object(sys, "argv", ["bounded-run.py", sys.executable, "-c", body]),
            patch.object(bounded, "LIMIT", limit),
            patch.object(bounded.tempfile, "mkdtemp", own_root),
            contextlib.redirect_stdout(output),
        ):
            try:
                return bounded.main()
            finally:
                self.assertTrue(roots)
                self.assertTrue(all(not root.exists() for root in roots))
                self.assertIn("temporary state removed", output.getvalue())

    def test_failure_preserves_exit_status_and_cleans_state(self):
        result = self.run_fixture("import os,sys; from pathlib import Path; (Path(os.environ['TMPDIR'])/'tiny').write_text('x'); sys.exit(7)")
        self.assertEqual(result, 7)

    def test_quota_breach_stops_fixture_and_cleans_state(self):
        with self.assertRaisesRegex(RuntimeError, "fixture disk limit"):
            self.run_fixture("import os,time; from pathlib import Path; (Path(os.environ['TMPDIR'])/'tiny').write_bytes(bytes(65)); time.sleep(30)", limit=64)

    def test_free_space_refusal_starts_no_child_and_cleans_state(self):
        with patch.object(bounded, "FREE_FLOOR", 2**80):
            with self.assertRaisesRegex(RuntimeError, "nothing started"):
                self.run_fixture("raise Exception('must not start')")


if __name__ == "__main__":
    unittest.main()
