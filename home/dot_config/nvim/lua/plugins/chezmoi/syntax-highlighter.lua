return {
  -- Spec Source
  'alker0/chezmoi.vim',
  name = 'chezmoi-syntax-highlighter',

  -- Spec Setup
  init = function()
    -- This option is required.
    vim.g['chezmoi#use_tmp_buffer'] = true
  end,

  -- Spec Lazy Loading
  lazy = false,
}
