local M = {}

-- ref: https://github.com/nvim-telescope/telescope-fzf-native.nvim#telescope-setup-and-configuration
M.config = function(opts)
  return opts
end

M.setup = function()
  require("telescope._extensions").set_config { ["fzf"] = M.config {} }
  require("telescope").load_extension "fzf"
end

return M
