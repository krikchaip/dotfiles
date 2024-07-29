return {
  setup = function(actions)
    actions.map {
      { 'q', actions.close_current, 'Preview: Close Current Window' },
      { 'Q', actions.close_all_wins, 'Preview: Close All Windows' },
      { '<CR>', actions.open_preview 'default', 'Preview: Replace Parent Window' },
      { 's', actions.open_preview 'horizontal', 'Preview: Split Horizontally' },
      { 'v', actions.open_preview 'vertical', 'Preview: Split Vertically' },
      { 't', actions.open_preview 'tab', 'Preview: Open in New Tab' },
    }
  end,
}
