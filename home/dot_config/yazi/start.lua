-- workaround for launching Yazi within a tmux popup.
-- ref: https://github.com/sxyazi/yazi/issues/2308

vim.o.cmdheight = 0
vim.o.laststatus = 0
vim.o.shadafile = "NONE"
vim.o.termguicolors = true

vim.api.nvim_set_hl(0, "Normal", { fg = "#999999", bg = "NONE", ctermbg = "NONE" })

vim.api.nvim_create_autocmd("BufEnter", {
	once = true,
	pattern = "*",
	callback = function()
		local path = vim.fn.argv()[1]
		path = (path and path ~= "") and path or vim.fn.getcwd()

		vim.cmd("startinsert")

		vim.fn.termopen({ "yazi", path }, {
			on_exit = function()
				vim.cmd("q")
			end,
		})
	end,
})
