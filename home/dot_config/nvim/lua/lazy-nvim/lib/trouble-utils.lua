---@diagnostic disable: missing-parameter
---
local M = {}

function M.show_panel(name)
  return function()
    local trouble = require 'trouble'

    if not trouble.is_open(name) then return trouble.open(name) end
    return trouble.focus(name)
  end
end

return M
