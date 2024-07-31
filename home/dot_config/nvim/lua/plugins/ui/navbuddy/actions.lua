local actions = require 'nvim-navbuddy.actions'

actions.fuzzy_current = actions.telescope

actions.fuzzy_document = function(opts)
  local callback = function(display)
    local status_ok, pickers = pcall(require, 'telescope.builtin')
    if not status_ok then
      vim.notify('telescope.nvim not found', vim.log.levels.ERROR)
      return
    end

    display:close()

    pickers.lsp_document_symbols(opts)
  end

  return {
    callback = callback,
    description = 'Fuzzy search document with telescope',
  }
end

return actions
