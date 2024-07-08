return {
  enable = true,

  -- Some languages depend on vim's regex highlighting system (such as Ruby) for indent rules.
  -- If you are experiencing weird indenting issues, add the language to
  -- the list of additional_vim_regex_highlighting and disabled languages for indent.
  additional_vim_regex_highlighting = {
    'ruby',
  },

  disable = function(lang, _)
    -- NOTE: these are the names of the parsers and not the filetype.
    local ignored_list = { 'json', 'jsonc', 'chezmoitmpl' }

    for _, ignored in ipairs(ignored_list) do
      if string.find(lang, ignored) or string.find(vim.bo.filetype, ignored) then return true end
    end
  end,
}
