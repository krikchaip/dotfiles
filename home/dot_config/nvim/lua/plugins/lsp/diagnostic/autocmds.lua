-- Show diagnostics automatically in hover window
-- ref: https://stackoverflow.com/questions/69290794/nvim-lsp-change-lspconfig-diagnostic-message-location
--      https://neovim.discourse.group/t/how-to-show-diagnostics-on-hover/3830/3
--      https://github.com/neovim/nvim-lspconfig/wiki/UI-Customization#show-line-diagnostics-automatically-in-hover-window
function setup_diagnostic_hover(bufnr)
  vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
    desc = 'Display diagnostics on hover',
    group = vim.api.nvim_create_augroup('diagnostic-hover', { clear = true }),
    buffer = bufnr,
    callback = function()
      vim.diagnostic.open_float(nil)
    end,
  })
end
