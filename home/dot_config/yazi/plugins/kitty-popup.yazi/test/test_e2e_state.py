"""Reject stale test copies before sending any real terminal keys."""

import pathlib
import shutil
import tempfile
import unittest

from e2e import SOURCE, check_prepared_config


class PreparedConfigTests(unittest.TestCase):
    def setUp(self):
        self.context = tempfile.TemporaryDirectory(prefix="ykp-config-test-")
        self.addCleanup(self.context.cleanup)
        self.root = pathlib.Path(self.context.name)
        plugin = self.root / "yazi/plugins/kitty-popup.yazi"
        plugin.mkdir(parents=True)
        self.paths = []
        for name in ("main.lua", "main.py", "preview.py"):
            target = plugin / name
            shutil.copyfile(SOURCE / name, target)
            self.paths.append(target)
        for name in ("init.lua", "yazi.toml"):
            target = self.root / "yazi" / name
            shutil.copyfile(SOURCE.parent.parent / name, target)
            self.paths.append(target)

    def test_current_copy_is_accepted(self):
        check_prepared_config(self.root)

    def test_each_stale_file_is_rejected_with_prepare_instruction(self):
        for target in self.paths:
            with self.subTest(file=target.name):
                original = target.read_bytes()
                target.write_bytes(original + b"\n-- stale test copy\n")
                with self.assertRaisesRegex(ValueError, "run prepare_e2e.py first"):
                    check_prepared_config(self.root)
                target.write_bytes(original)

    def test_missing_file_is_rejected_with_prepare_instruction(self):
        self.paths[0].unlink()
        with self.assertRaisesRegex(ValueError, "run prepare_e2e.py first"):
            check_prepared_config(self.root)


if __name__ == "__main__":
    unittest.main()
