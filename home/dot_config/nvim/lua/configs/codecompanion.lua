local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup
local map = vim.keymap.set

M.config = function(opts)
  opts.adapters = {
    gemini_flash = function()
      return require("codecompanion.adapters").extend("gemini", {
        name = "gemini_flash",
        schema = { model = { default = "gemini-2.5-flash" } },
      })
    end,

    gemini_pro = function()
      return require("codecompanion.adapters").extend("gemini", {
        name = "gemini_pro",
        schema = { model = { default = "gemini-2.5-pro" } },
      })
    end,

    opts = {
      show_defaults = false,
      show_model_choices = false,
    },
  }

  opts.strategies = {
    chat = {
      adapter = "gemini_flash",
      keymaps = {
        options = { modes = { n = { "?", "g?", "<C-/>" }, i = { "<C-/>" } } },
        send = { modes = { n = "<CR>", i = "<S-CR>" } },
        regenerate = { modes = { n = "<localleader>r" } },
        close = { modes = { n = "<C-q>", i = "<C-q>" } },
        stop = { modes = { n = "<localleader>x" } },
        clear = { modes = { n = "<localleader>c" } },
        codeblock = { modes = { n = "<localleader>b" } },
        yank_code = { modes = { n = "<localleader>y" } },
        pin = { modes = { n = "<localleader>p" } },
        watch = { modes = { n = "<localleader>w" } },
        change_adapter = { modes = { n = "<localleader>a" } },
        fold_code = { modes = { n = "<localleader>z" } },
        debug = { modes = { n = "<localleader>d" } },
        system_prompt = { modes = { n = "<localleader>s" } },
        auto_tool_mode = { modes = { n = "<localleader>t" } },
        goto_file_under_cursor = { modes = { n = "gf" }, description = "Open the file under cursor" },
        copilot_stats = { modes = { n = "<localleader>S" } },
      },
      opts = { goto_file_action = "edit" },
    },

    inline = {
      adapter = "gemini_flash",
      keymaps = {
        accept_change = { modes = { n = "<C-a>" } },
        reject_change = { modes = { n = "<C-x>" } },
      },
    },

    cmd = {
      adapter = "gemini_flash",
    },
  }

  opts.display = {
    chat = {
      auto_scroll = false,
      window = { layout = "float", width = 0.5, opts = { number = false, wrap = true, winfixbuf = true } },
    },
    inline = { layout = "buffer" },
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
end

M.on_attach = function(bufnr)
  local function opts(desc)
    return { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
  end

  map("n", "q", LLM.ToggleChat, opts "CodeCompanion: Close Chat")
end

return M
