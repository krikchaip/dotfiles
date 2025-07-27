local M = {}

M.setup = function()
  require("lint").linters_by_ft = {
    javascript = { "eslint_d" },
    typescript = { "eslint_d" },
    javascriptreact = { "eslint_d" },
    typescriptreact = { "eslint_d" },
    vue = { "eslint_d" },

    go = { "golangcilint" },
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

  vim.cmd "au BufWritePost,InsertLeave * lua require('lint').try_lint()"
end

return M
