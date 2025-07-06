return {
  -- Spec Source
  'bfontaine/Brewfile.vim',
  name = 'homebrew-syntax-highlighter',

  -- Spec Lazy Loading
  event = {
    'BufReadPre *Brewfile',
    'BufNewFile *Brewfile',
  },
}
