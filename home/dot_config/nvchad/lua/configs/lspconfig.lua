local M = {}

M.setup = function()
  require("nvchad.configs.lspconfig").defaults()

  -- read :h vim.lsp.config for changing options of lsp servers
  local servers = {
    lua_ls = {},

    gopls = {},

    pyright = {},

    dockerls = {},

    nushell = {},

    jsonls = {},
    yamlls = {},

    html = {},

    cssls = {},
    emmet_ls = {},
    tailwindcss = {},

    ts_ls = {},
    vue_ls = {},
  }

  for name, opts in pairs(servers) do
    vim.lsp.config(name, opts)
    vim.lsp.enable(name)
  end
end

return M
