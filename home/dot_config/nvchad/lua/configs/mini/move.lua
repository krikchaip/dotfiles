local M = {}

M.config = function(opts)
  opts.mappings = {
    -- visual mode
    left = "<M-S-Left>",
    right = "<M-S-Right>",
    down = "<M-S-Down>",
    up = "<M-S-Up>",

    -- normal mode
    line_left = "<M-S-Left>",
    line_right = "<M-S-Right>",
    line_down = "<M-S-Down>",
    line_up = "<M-S-Up>",
  }

  return opts
end

return M
