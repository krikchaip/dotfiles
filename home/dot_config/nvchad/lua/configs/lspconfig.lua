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

    jsonls = {
      settings = {
        json = {
          format = { enable = false },
          validate = { enable = true },
          schemas = require("configs.schemastore").json(),
        },
      },
    },
    yamlls = {
      settings = {
        yaml = {
          validate = true,
          hover = true,
          completion = true,
          format = { enable = false },
          schemaStore = { enable = false, url = "" },
          schemas = require("configs.schemastore").yaml(),
        },
      },
    },
    taplo = {},

    html = {},

    cssls = {},
    emmet_ls = {},
    tailwindcss = {},

    ts_ls = {
      settings = {
        expose_as_code_action = "all", -- specify commands exposed as code_actions
      },
    },

    vue_ls = {},

    -- a dedicated tsserver for .vue files
    -- ref: https://github.com/vuejs/language-tools/wiki/Neovim
    vtsls = {
      settings = {
        vtsls = {
          tsserver = {
            globalPlugins = {
              {
                name = "@vue/typescript-plugin",
                location = vim.fn.stdpath "data"
                  .. "/mason/packages/vue-language-server/node_modules/@vue/language-server",
                languages = { "vue" },
                configNamespace = "typescript",
              },
            },
          },
        },
      },
      filetypes = { "vue" },
    },
  }

  -- disable the default inline virtual text for diagnostics,
  -- as 'tiny-inline-diagnostic' will handle it.
  vim.diagnostic.config { virtual_text = false }

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
