return {
  setup = function(actions)
    actions.map {
      { 'q', actions.close_current, 'Preview: Close Current Window' },
      { 'Q', actions.close_all_wins, 'Preview: Close All Windows' },
      { '<CR>', actions.open_preview 'default', 'Preview: Replace Parent Window' },
      { '<C-s>', actions.open_preview 'horizontal', 'Preview: Split Horizontally' },
      { '<C-v>', actions.open_preview 'vertical', 'Preview: Split Vertically' },
      { '<C-t>', actions.open_preview 'tab', 'Preview: Open in New Tab' },
    }
  end,
}
