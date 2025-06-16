local M = {}

local autocmd = vim.api.nvim_create_autocmd
local nomap = vim.keymap.del

M.setup = function()
  require("nvchad.configs.lspconfig").defaults()

  autocmd("LspAttach", {
    callback = function(args)
      M.on_attach(args.buf)
    end,
  })

  -- read :h vim.lsp.config for changing options of lsp servers
  local servers = {
    lua_ls = {},

    -- settings: https://github.com/golang/tools/blob/master/gopls/doc/settings.md
    -- analyzers: https://github.com/golang/tools/blob/master/gopls/doc/analyzers.md
    gopls = {
      settings = {
        gopls = {
          templateExtensions = {},
          gofumpt = false,
          usePlaceholders = true,
          analyses = { unusedvariable = true, useany = true },
        },
      },
    },

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

M.on_attach = function(buf)
  local opts = { buffer = buf }

  -- remove default nvchad mappings
  -- ref: https://github.com/NvChad/NvChad/blob/v2.5/lua/nvchad/configs/lspconfig.lua
  nomap("n", "gD", opts)
  nomap("n", "gd", opts)
  nomap("n", "<leader>wa", opts)
  nomap("n", "<leader>wr", opts)
  nomap("n", "<leader>wl", opts)
  nomap("n", "<leader>D", opts)
  nomap("n", "<leader>ra", opts)
end

return M
