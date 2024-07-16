-- Image previewer that supports kitty-based protocol
return {
  -- Spec Source
  '3rd/image.nvim',
  name = 'image',

  -- Spec Setup
  opts = {
    max_width_window_percentage = 50,
    max_height_window_percentage = 50,

    -- toggles images when windows are overlapped
    window_overlap_clear_enabled = false,

    -- auto show/hide images when the editor gains/looses focus
    editor_only_render_when_focused = false,

    integrations = {
      html = { enabled = true },
      css = { enabled = true },
    },

    -- render image files as images when opened
    hijack_file_patterns = {
      '*.png',
      '*.svg',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.avif',
    },
  },

  -- Spec Lazy Loading
  event = 'User FilePost',

  -- Spec Versioning
  commit = '94319cd', -- FIXME: pinned until #191 has been fixed
}
