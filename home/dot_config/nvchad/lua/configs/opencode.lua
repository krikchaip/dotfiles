local M = {}

local opencode_envs = {
  -- disable OSC52 DCS passthrough; prevents base64 clipboard gibberish in nested terminals
  -- (opencode > nvim float > tmux) ref: opencode.ai #11996 #19982
  "TMUX=",

  "OPENCODE_EXPERIMENTAL_LSP_TOOL=true",
  "OPENCODE_ENABLE_EXA=true",
  "NVIM_APPNAME=nvchad",
  "EDITOR=nvim",
}

local opencode_opts = {
  id = "opencode.server",
  pos = "float",
  cmd = table.concat(opencode_envs, " ") .. " opencode --port",
  winopts = { winfixbuf = true },
  float_opts = {
    width = 0.7,
    height = 0.7,
    row = 0.1,
    col = 0.15,
  },
}

--- @param opts opencode.Opts
M.config = function(opts)
  opts.ask = {
    snacks = { icon = "", win = { width = 40 } },
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

  -- Force opencode's select flow to use snacks.picker only.
  M.patch_select_picker()

  ---@type opencode.Opts
  vim.g.opencode_opts = M.config(opts)
end

-- Patch opencode's Promise.select to route through snacks.picker.select,
-- while keeping global vim.ui.select behavior unchanged.
M.patch_select_picker = function()
  local ok_ui, ui = pcall(require, "opencode.promise.ui")
  if not ok_ui then return end

  ui.select = function(items, opts)
    local Promise = require "opencode.promise"

    return Promise.new(function(resolve, reject)
      local ok_snacks, snacks = pcall(require, "snacks")

      local on_choice = function(choice)
        if choice == nil then
          reject()
        else
          resolve(choice)
        end
      end

      if ok_snacks and snacks.picker and snacks.picker.select then
        snacks.picker.select(items, opts or {}, on_choice)
      else
        vim.ui.select(items, opts or {}, on_choice)
      end
    end)
  end

  local Promise = require "opencode.promise"
  Promise.select = ui.select
end

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
