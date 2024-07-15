return {
  -- Spec Source
  'rcarriga/nvim-notify',
  name = 'notify',

  -- Spec Setup
  opts = {
    -- 'default', 'minimal', 'simple', 'compact', 'wrapped-compact'
    -- ref: https://github.com/rcarriga/nvim-notify?tab=readme-ov-file#render-style
    render = 'default',

    -- 'fade_in_slide_out', 'fade', 'slide', 'static'
    -- ref: https://github.com/rcarriga/nvim-notify?tab=readme-ov-file#animation-style
    stages = 'fade_in_slide_out',

    timeout = 2000,
    top_down = true,

    minimum_width = 30,

    -- `(number|function)` Max number of columns for messages
    max_width = 60,

    -- `(number|function)` Max number of lines for a message
    -- max_height = nil,
  },

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
