local M = {}

local get_option = vim.filetype.get_option

M.config = function(opts)
  opts.enable_autocmd = false

  return opts
end

M.setup = function()
  require("ts_context_commentstring").setup(M.config {})

  -- native commenting in Neovim 0.10
  -- ref: https://github.com/JoosepAlviste/nvim-ts-context-commentstring/wiki/Integrations#native-commenting-in-neovim-010
  vim.filetype.get_option = function(filetype, option)
    if option == "commentstring" then
      return require("ts_context_commentstring.internal").calculate_commentstring()
    else
      return get_option(filetype, option)
    end
  end
end

return M
