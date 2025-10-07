local M = {}

M.config = function(opts)
  opts.default = {
    dir_path = "/tmp/img-clip",
    use_absolute_path = true,
    prompt_for_file_name = false,
  }

  opts.filetypes = {
    codecompanion = { template = "[Image]($FILE_PATH)" },
  }

  return opts
end

return M
