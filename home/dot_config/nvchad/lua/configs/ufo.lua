local M = {}

local opt = vim.opt
local o = vim.o

M.options = function()
  -- limit fold columns to just one (chevron icon)
  o.foldcolumn = "1"

  -- expand all folds by default
  -- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
  o.foldlevel = 999
  o.foldlevelstart = 999

  -- folds will be reenabled by the plugin
  o.foldenable = true

  -- custom set of fold characters on statuscol
  opt.fillchars = { eob = " ", fold = " ", foldsep = " ", foldopen = "", foldclose = "" }
end

M.config = function(opts)
  opts.provider_selector = M.treesitter_provider
  opts.fold_virt_text_handler = M.number_suffix

  return opts
end

M.setup = function(opts)
  M.options()
  require("ufo").setup(M.config(opts))
end

-- treesitter as a main folding provider
-- (Note: the `nvim-treesitter` plugin is **not** needed.)
-- ufo uses the same query files for folding (queries/<lang>/folds.scm)
-- performance and stability are better than `foldmethod=nvim_treesitter#foldexpr()`
--
---@diagnostic disable-next-line: unused-local
M.treesitter_provider = function(bufnr, filetype, buftype)
  return { "treesitter", "indent" }
end

-- adding number suffix of folded lines instead of the default ellipsis
M.number_suffix = function(virtText, lnum, endLnum, width, truncate)
  local newVirtText = {}
  local suffix = (" 󰁂 %d "):format(endLnum - lnum)
  local sufWidth = vim.fn.strdisplaywidth(suffix)
  local targetWidth = width - sufWidth
  local curWidth = 0

  for _, chunk in ipairs(virtText) do
    local chunkText = chunk[1]
    local chunkWidth = vim.fn.strdisplaywidth(chunkText)

    if targetWidth > curWidth + chunkWidth then
      table.insert(newVirtText, chunk)
    else
      chunkText = truncate(chunkText, targetWidth - curWidth)

      local hlGroup = chunk[2]
      table.insert(newVirtText, { chunkText, hlGroup })

      chunkWidth = vim.fn.strdisplaywidth(chunkText)

      -- str width returned from truncate() may less than 2nd argument, need padding
      if curWidth + chunkWidth < targetWidth then suffix = suffix .. (" "):rep(targetWidth - curWidth - chunkWidth) end

      break
    end

    curWidth = curWidth + chunkWidth
  end

  table.insert(newVirtText, { suffix, "MoreMsg" })

  return newVirtText
end

return M
