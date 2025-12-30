local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup
local map = vim.keymap.set

local spinner = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
local watch_list = { "ChatStopped", "RequestStarted", "RequestFinished", "DiffAccepted", "DiffRejected" }

M.config = function(opts)
  opts.interactions = {
    chat = {
      adapter = "gemini",
      keymaps = {
        options = { modes = { n = { "?", "g?", "<C-/>" }, i = { "<C-/>" } } },
        send = { modes = { n = "<CR>", i = "<S-CR>" } },
        regenerate = { modes = { n = "<localleader>r" } },
        close = { modes = { n = "<C-q>", i = "<C-q>" } },
        stop = { modes = { n = "<localleader><Space>" } },
        clear = { modes = { n = "<localleader>D" } },
        codeblock = { modes = { n = "<localleader>q" } },
        yank_code = { modes = { n = "<localleader>y" } },
        buffer_sync_all = { modes = { n = "<localleader>>" } },
        buffer_sync_diff = { modes = { n = "<localleader>." } },
        change_adapter = { modes = { n = "<localleader>a" } },
        fold_code = { modes = { n = "<localleader>z" } },
        debug = { modes = { n = "<localleader>e" } },
        system_prompt = { modes = { n = "<M-s>" } },
        goto_file_under_cursor = { modes = { n = "gf" }, description = "Open the file under cursor" },
        copilot_stats = { modes = { n = "<localleader>C" } },
      },
      tools = {
        opts = { default_tools = { "web_search" } },
      },
      opts = { goto_file_action = "edit" },
    },

    inline = {
      adapter = "gemini",
      keymaps = {
        accept_change = { modes = { n = "<C-a>" } },
        reject_change = { modes = { n = "<C-x>" } },
        always_accept = { modes = { n = "<C-M-a>" } },
      },
    },

    cmd = {
      adapter = "gemini",
    },
  }

  opts.display = {
    chat = {
      auto_scroll = false,
      intro_message = "",
      window = { layout = "float", width = 0.5, opts = { number = false, wrap = true, winfixbuf = true } },
    },
    inline = { layout = "buffer" },
  }

  if vim.g.minimal then
    opts.strategies.chat.keymaps.close.modes = { n = "q" }
    opts.display.chat.intro_message = nil
    opts.display.chat.window = { layout = "buffer", opts = { number = false, wrap = true } }
  end

  opts.extensions = {
    history = {
      enabled = true,
      opts = {
        keymap = "<localleader>h",
        save_chat_keymap = "<localleader>w",
        picker_keymaps = { delete = { i = "<C-c>" } },

        auto_save = false,
        delete_on_clearing_chat = true,

        title_generation_opts = {
          adapter = "gemini",
          model = "gemini-2.5-flash",
        },

        summary = {
          create_summary_keymap = "<localleader>S",
          browse_summaries_keymap = "<localleader>s",
          generation_opts = { adapter = "gemini", model = "gemini-2.5-flash" },
        },

        chat_filter = function(chat_data)
          return chat_data.project_root == Snacks.git.get_root(vim.uv.cwd())
        end,
      },
    },
  }

  return opts
end

M.setup = function(opts)
  require("codecompanion").setup(M.config(opts))

  autocmd("FileType", {
    group = augroup("codecompanion.mapping", { clear = true }),
    pattern = "codecompanion",
    callback = function(args)
      M.on_attach(args.buf)
    end,
  })

  autocmd("User", {
    group = augroup("codecompanion.fidget", { clear = true }),
    pattern = "CodeCompanion*",
    callback = function(args)
      M.notify_status(args)
    end,
  })

  autocmd("User", {
    group = augroup("codecompanion.unmap", { clear = true }),
    pattern = "CodeCompanionDiffAttached",
    callback = function(args)
      pcall(vim.api.nvim_buf_del_keymap, args.buf, "n", "q")
    end,
  })

  autocmd("User", {
    group = augroup("codecompanion.format", { clear = true }),
    pattern = "CodeCompanionDiffAccepted",
    callback = function(args)
      Conform.FormatBuf(args.buf)
    end,
  })
end

M.on_attach = function(bufnr)
  local function opts(desc)
    return { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
  end

  map("n", "q", LLM.ToggleChat, opts "CodeCompanion: Close Chat")
end

-- Snacks.notifier integration for status update displays fidget spinner
-- ref: https://github.com/olimorris/codecompanion.nvim/discussions/813#discussioncomment-13080521
M.notify_status = function(request)
  local event_name = request.match:gsub("CodeCompanion", "")
  local msg = "[CodeCompanion] " .. event_name

  if not vim.tbl_contains(watch_list, event_name) then return end

  vim.notify(msg, vim.log.levels.INFO, {
    id = "code_companion_status",
    title = "Code Companion Status",
    timeout = 1000,

    keep = function()
      return vim.endswith(event_name, "Started")
    end,

    opts = function(notif)
      notif.icon = ""
      if vim.endswith(event_name, "Started") then
        ---@diagnostic disable-next-line: undefined-field
        notif.icon = spinner[math.floor(vim.uv.hrtime() / (1e6 * 80)) % #spinner + 1]
      elseif vim.endswith(event_name, "Finished") then
        notif.icon = " "
      end
    end,
  })
end

return M
