local M = {}

--- @param opts opencode.Opts
M.config = function(opts)
  opts.ask = {
    snacks = { icon = "", win = { width = 33, footer_pos = "left" } },
  }

  opts.server = {
    start = M.start_term,
    stop = M.stop_term,
    toggle = M.toggle_term,
  }

  return opts
end

M.setup = function(opts)
  -- Required for `opts.events.reload`
  vim.o.autoread = true

  ---@type opencode.Opts
  vim.g.opencode_opts = M.config(opts)
end

local opencode_opts = {
  id = "opencode.server",
  pos = "float",
  cmd = "opencode --port",
  float_opts = {
    width = 0.7,
    height = 0.7,
    row = 0.15,
    col = 0.15,
  },
}

M.get_term = function()
  for _, term in pairs(vim.g.nvchad_terms or {}) do
    if term and term.id == opencode_opts.id then return term end
  end
end

M.start_term = function()
  local term = M.get_term()
  if term and term.buf and vim.api.nvim_buf_is_valid(term.buf) then return end

  require("nvchad.term").toggle(opencode_opts)

  term = M.get_term()
  if not term or not term.buf or not vim.api.nvim_buf_is_valid(term.buf) then return end

  local win = vim.fn.bufwinid(term.buf)
  if win ~= -1 then vim.api.nvim_win_close(win, true) end
end

M.stop_term = function()
  local term = M.get_term()
  if not term or not term.buf or not vim.api.nvim_buf_is_valid(term.buf) then return end

  local buf = term.buf
  local win = vim.fn.bufwinid(buf)
  local job_id = vim.b[buf].terminal_job_id

  if job_id then vim.fn.jobstop(job_id) end
  if win ~= -1 then vim.api.nvim_win_close(win, true) end

  pcall(vim.api.nvim_buf_delete, buf, { force = true })
  vim.g.nvchad_terms[tostring(buf)] = nil
end

M.toggle_term = function()
  require("nvchad.term").toggle(opencode_opts)
end

return M
