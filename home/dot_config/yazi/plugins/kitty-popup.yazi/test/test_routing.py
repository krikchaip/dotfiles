"""main.lua picks the plugins that yazi's own rules give a file.

These tests run main.lua in LuaJIT (or Lua) with small stand-ins for yazi's
API, so they need no yazi: `rt.plugin.previewers:match()` gives the rules,
and each preset plugin records its calls.
"""

import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

MAIN = pathlib.Path(__file__).resolve().parent.parent / "main.lua"
LUA = shutil.which("luajit") or shutil.which("lua")

# The stand-ins. RULES maps a mime to the names of the rules that match it,
# in yazi's order; CACHE is ya.file_cache(); CALLS records what happens.
DRIVER = r"""
table.unpack = table.unpack or unpack
local case = CASE
CALLS = {}
local function record(text) CALLS[#CALLS + 1] = text end
local function chain()
    local object = {}
    setmetatable(object, { __index = function() return function(self) return self end end })
    return object
end
local cached = {}
local function preset_plugin(name)
    return {
        peek = function(_, job) record(name .. ":peek args=" .. tostring(job.args.tag)) end,
        seek = function(_, job) record(name .. ":seek") end,
        spot = function(_, job) record(name .. ":spot") end,
        preload = function(_, job)
            record(name .. ":preload")
            if case.preload_makes_cache then cached[case.cache] = true end
            return true
        end,
    }
end
local real_require = require
require = function(name)
    if name == "kitty-popup" then return real_require(name) end
    return preset_plugin(name)
end
local function rules(kind)
    return { match = function(_, pair)
        local found = {}
        for index, name in ipairs(case.rules[kind][pair.mime] or {}) do
            found[index] = { name = name, args = { tag = name .. "-args" } }
        end
        return found
    end }
end
rt = { plugin = { previewers = rules("previewers"), spotters = rules("spotters") },
       preview = { image_delay = 0, max_width = 600, max_height = 900 } }
ya = {
    sync = function(fn) return function(...) return fn({}, ...) end end,
    file_cache = function() return case.cache end,
    sleep = function() end,
    preview_widget = function() record("widget") end,
    json_decode = function() return { rows = { "x" }, color = "#000001" } end,
    emit = function() end,
    quote = function(text) return text end,
}
fs = { cha = function(url) if cached[tostring(url)] then return { len = 1 } end end }
ps = { sub = function(kind) record("subscribe:" .. kind) end }
ui = { Line = chain, Span = chain, Text = chain, Clear = chain }
Command = function(program)
    local command = {}
    function command:arg(args) record(program .. " " .. table.concat(args, " ")) return self end
    function command:output() return { status = { success = true }, stdout = "{}" } end
    return command
end
package.path = case.plugin_dir .. "/?.lua;" .. package.path
package.loaded["kitty-popup"] = dofile(case.main)
local M = package.loaded["kitty-popup"]
M:setup()
local job = { mime = case.mime, args = {}, area = { x = 1, y = 2, w = 30, h = 10 },
              file = { path = case.file, url = case.file } }
M[case.method](M, job)
for _, text in ipairs(CALLS) do print(text) end
"""

RULES = {
    "previewers": {
        "image/svg+xml": ["kitty-popup", "svg", "image"],
        "image/heic": ["kitty-popup", "magick", "image"],
        "image/png": ["kitty-popup", "image"],
        "video/mp4": ["kitty-popup", "video"],
    },
    "spotters": {"image/svg+xml": ["svg-spotter"], "image/png": ["image"]},
}


@unittest.skipUnless(LUA, "needs luajit or lua")
class Routing(unittest.TestCase):
    def run_lua(self, method, mime, env=None, preload_makes_cache=True):
        with tempfile.TemporaryDirectory() as folder:
            case = {"rules": RULES, "mime": mime, "method": method, "file": "/pics/a",
                    "cache": "/cache/a", "main": str(MAIN), "plugin_dir": folder,
                    "preload_makes_cache": preload_makes_cache}
            script = pathlib.Path(folder) / "driver.lua"
            # JSON is a Lua table constructor once its keys are written as Lua keys.
            script.write_text("CASE = " + lua_table(case) + "\n" + DRIVER, encoding="utf-8")
            base = {key: value for key, value in os.environ.items()
                    if key not in ("TOGGLE_POPUP_IMAGE_SOCKET", "__tmux_popup_name")}
            result = subprocess.run([LUA, str(script)], env={**base, **(env or {})},
                                    capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.splitlines()

    def test_outside_popups_each_type_gets_the_preset_previewer(self):
        for mime, name in (("image/svg+xml", "svg"), ("image/heic", "magick"),
                           ("image/png", "image"), ("video/mp4", "video")):
            with self.subTest(mime=mime):
                self.assertEqual(self.run_lua("peek", mime), [f"{name}:peek args={name}-args"])
                self.assertEqual(self.run_lua("seek", mime), [f"{name}:seek"])

    def test_outside_popups_spot_uses_the_preset_spotter(self):
        self.assertEqual(self.run_lua("spot", "image/svg+xml"), ["svg-spotter:spot"])

    def test_outside_popups_setup_subscribes_to_nothing(self):
        self.assertEqual(self.run_lua("seek", "image/png"), ["image:seek"])

    def test_in_a_herdr_popup_the_preset_preloader_makes_the_image(self):
        env = {"TOGGLE_POPUP_IMAGE_SOCKET": "/tmp/x.sock", "YAZI_CONFIG_HOME": "/cfg"}
        calls = self.run_lua("peek", "image/svg+xml", env)
        self.assertEqual(calls[0], "subscribe:hover")
        self.assertEqual(calls[1], "svg:preload")
        helper = next(call for call in calls if call.startswith("python3 "))
        # The rendered SVG goes to the proxy, not the SVG file.
        self.assertEqual(helper.split()[1:5],
                         ["/cfg/plugins/kitty-popup.yazi/herdr.py", "show", "0", "/pics/a"])
        self.assertEqual(helper.split()[5], "/cache/a")

    def test_in_a_herdr_popup_a_type_without_a_cache_sends_the_file(self):
        env = {"TOGGLE_POPUP_IMAGE_SOCKET": "/tmp/x.sock", "YAZI_CONFIG_HOME": "/cfg"}
        calls = self.run_lua("peek", "image/png", env, preload_makes_cache=False)
        helper = next(call for call in calls if call.startswith("python3 "))
        self.assertEqual(helper.split()[5], "/pics/a")


def lua_table(value):
    if isinstance(value, dict):
        return "{" + ", ".join(f"[{json.dumps(key)}] = {lua_table(item)}"
                               for key, item in value.items()) + "}"
    if isinstance(value, list):
        return "{" + ", ".join(lua_table(item) for item in value) + "}"
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value)


if __name__ == "__main__":
    unittest.main()
