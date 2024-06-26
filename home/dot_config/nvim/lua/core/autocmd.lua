---@diagnostic disable: lowercase-global

-- [[ lua-guide-autocommands, autocmd-events ]]

-- highlight when yanking (copying) text
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('highlight-yank', { clear = true }),
  callback = function() vim.highlight.on_yank() end,
})

-- Show diagnostics automatically in hover window
-- ref: https://stackoverflow.com/questions/69290794/nvim-lsp-change-lspconfig-diagnostic-message-location
--      https://neovim.discourse.group/t/how-to-show-diagnostics-on-hover/3830/3
--      https://github.com/neovim/nvim-lspconfig/wiki/UI-Customization#show-line-diagnostics-automatically-in-hover-window
function setup_diagnostic_hover(event)
  vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
    desc = 'Display diagnostics on hover',
    group = vim.api.nvim_create_augroup('diagnostic-hover', { clear = true }),
    buffer = event.buf,
    callback = function() vim.diagnostic.open_float(nil) end,
  })
end

-- used to highlight references of the word under the cursor
-- when the cursor rests there for a little while
function setup_highlight_references_hover(event)
  local client = vim.lsp.get_client_by_id(event.data.client_id)

  if client and client.server_capabilities.documentHighlightProvider then
    local hl_group = vim.api.nvim_create_augroup('highlight-references-hover', { clear = false })
    local detach_group = vim.api.nvim_create_augroup('highlight-references-detach', { clear = true })

    vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
      desc = 'Highlight references of the word under the cursor',
      group = hl_group,
      buffer = event.buf,
      callback = vim.lsp.buf.document_highlight,
    })

    -- when you move your cursor, the highlights will be cleared
    vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
      desc = 'Clear reference highlights when moving the cursor away',
      group = hl_group,
      buffer = event.buf,
      callback = vim.lsp.buf.clear_references,
    })

    vim.api.nvim_create_autocmd('LspDetach', {
      desc = 'Clear reference highlights on LSP detach',
      group = detach_group,
      callback = function(detach_event)
        vim.lsp.buf.clear_references()
        vim.api.nvim_clear_autocmds { group = hl_group, buffer = detach_event.buf }
      end,
    })
  end
end

-- Enable lsp inlay hints (for Nvim v0.10.0 and onwards)
-- ref: https://www.youtube.com/watch?v=DYaTzkw3zqQ
function setup_inlay_hints(event)
  local client = vim.lsp.get_client_by_id(event.data.client_id)

  if client and client.server_capabilities.inlayHintProvider and vim.lsp.inlay_hint then
    local opts = { buffer = event.buf, silent = true }

    opts.desc = 'LSP: Toggle Inlay Hints'
    vim.keymap.set('n', '<leader>lh', function()
      local is_enabled = vim.lsp.inlay_hint.is_enabled { 0 }
      vim.lsp.inlay_hint.enable(not is_enabled, { 0 })
    end, opts)
  end
end
