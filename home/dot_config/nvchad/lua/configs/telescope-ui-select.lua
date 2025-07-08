local M = {}

M.setup = function()
  local theme_dropdown = require("telescope.themes").get_dropdown()

  require("telescope._extensions").set_config { ["ui-select"] = { theme_dropdown } }
  require("telescope").load_extension "ui-select"
end

return M
