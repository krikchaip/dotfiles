local M = {}

M.setup = function()
  require("lint").linters_by_ft = {
    javascript = { "eslint_d" },
    typescript = { "eslint_d" },
    javascriptreact = { "eslint_d" },
    typescriptreact = { "eslint_d" },
    vue = { "eslint_d" },

    go = { "golangcilint" },

    python = { "flake8", "ruff" },
    htmldjango = { "djlint" },
  }

  local linters = require("lint").linters

  -- fix eslint_d warning when no config file presents
  -- ref: https://github.com/mfussenegger/nvim-lint/issues/462
  linters.eslint_d = require("lint.util").wrap(linters.eslint_d, function(diagnostic)
    -- try to ignore "No ESLint configuration found" error
    -- if diagnostic.message:find("Error: No ESLint configuration found") then -- old version
    -- update: 20240814, following is working
    ---@diagnostic disable-next-line: return-type-mismatch
    if diagnostic.message:find "Error: Could not find config file" then return nil end

    return diagnostic
  end)

  -- fix pylint displays import errors (unable to find packages from .venv)
  -- ref: https://github.com/mason-org/mason.nvim/issues/1336
  --      https://vi.stackexchange.com/questions/45737/pylint-unable-to-find-imports-from-currently-active-virtual-environment
  table.insert(linters.pylint.args, "--init-hook")
  table.insert(
    linters.pylint.args,
    "import base64;"
      .. "exec(base64.b64decode('"
      .. "aW1wb3J0IHN5cywgb3MKCmlmICdWSVJUVUFMX0VOVicgbm90IGluIG9zLmVudmlyb246CiAgICBze"
      .. "XMuZXhpdCgwKQoKdmVfZGlyID0gb3MuZW52aXJvblsnVklSVFVBTF9FTlYnXQppZiB2ZV9kaXIgbm9"
      .. "0IGluIHN5cy5wYXRoOgogICAgc3lzLnBhdGguaW5zZXJ0KDAsIHZlX2RpcikKCmFjdGl2YXRlX3RoaXM"
      .. "gPSBvcy5wYXRoLmpvaW4odmVfZGlyLCAnYmluJywgJ2FjdGl2YXRlX3RoaXMucHknKQoKIyBGaXgg"
      .. "Zm9yIHdpbmRvd3MKaWYgbm90IG9zLnBhdGguZXhpc3RzKGFjdGl2YXRlX3RoaXMpOgogICAgYWN"
      .. "0aXZhdGVfdGhpcyA9IG9zLnBhdGguam9pbih2ZV9kaXIsICdTY3JpcHRzJywgJ2FjdGl2YXRlX3RoaXM"
      .. "ucHknKQoKd2l0aCBvcGVuKGFjdGl2YXRlX3RoaXMsICdyJykgYXMgZjoKICAgIGV4ZWMoZi5yZWFkK"
      .. "CksIHsnX19maWxlX18nOiBhY3RpdmF0ZV90aGlzfSkK"
      .. "'))"
  )

  vim.cmd "au BufEnter,BufWritePost,InsertLeave * lua require('lint').try_lint()"
end

return M
