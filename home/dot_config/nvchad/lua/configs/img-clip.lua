local M = {}

M.config = function(opts)
  opts.filetypes = {
    codecompanion = {
      prompt_for_file_name = false,
      template = "[Image]($FILE_PATH)",
      use_absolute_path = true,
    },
  }

  return opts
end

return M
