"""Run the real Lua previewer to check its no-op boundary.

The native image previewer is the observation seam. No terminal, Python helper,
image transfer, or tmux command may run in an unrelated terminal context.
"""

import os
import pathlib
import shutil
import subprocess
import unittest


PLUGIN = pathlib.Path(__file__).resolve().parent.parent / "main.lua"
LUA = shutil.which("lua")
PROBE = r'''
local native_calls = 0
local job = { area = { w = 40, h = 20 }, file = { path = "/unused.png" } }
package.preload["image"] = function()
    return { peek = function(self, received)
        assert(received == job, "native preview must get the original job")
        native_calls = native_calls + 1
    end }
end
ya = { sync = function(fn)
    local state = {}
    return function(...) return fn(state, ...) end
end }
Command = function()
    error("custom helper must not start outside the owned popup")
end
local plugin = dofile(arg[1])
plugin:setup()
plugin:peek(job)
assert(native_calls == 1, "native preview must be called exactly once")
'''


@unittest.skipUnless(LUA, "Lua is required to execute the previewer boundary")
class NoOpTests(unittest.TestCase):
    def check_context(self, extra):
        env = dict(os.environ)
        for name in ("TMUX", "TMUX_PANE", "__tmux_popup_name", "YAZI_KITTY_HELPER", "YAZI_KITTY_SOCKET", "STY", "ZELLIJ"):
            env.pop(name, None)
        env["KITTY_WINDOW_ID"] = "99"
        env.update(extra)
        result = subprocess.run([LUA, "-", str(PLUGIN)], input=PROBE, text=True, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_delegation_without_owner_variables(self):
        for label, markers in (("Kitty", {}), ("GNU Screen", {"STY": "test"}), ("Zellij marker", {"ZELLIJ": "0"})):
            with self.subTest(context=label):
                self.check_context(markers)

    def test_inherited_owner_variables_do_not_activate_unrelated_contexts(self):
        for label, markers in (("Kitty", {}), ("GNU Screen", {"STY": "test"}), ("Zellij marker", {"ZELLIJ": "0"})):
            with self.subTest(context=label):
                self.check_context(dict(markers, YAZI_KITTY_HELPER="/unused-helper.py", YAZI_KITTY_SOCKET="/exited-owner"))

    def test_empty_context_fields_do_not_activate_the_helper(self):
        context = {"KITTY_WINDOW_ID": "99", "TMUX": "/tmp/inner,123,0", "TMUX_PANE": "%7",
                   "__tmux_popup_name": "yazi_pwd", "YAZI_KITTY_HELPER": "/unused-helper.py",
                   "YAZI_KITTY_SOCKET": "/exited-owner"}
        for name in context:
            with self.subTest(field=name):
                self.check_context(dict(context, **{name: ""}))


if __name__ == "__main__":
    unittest.main()
