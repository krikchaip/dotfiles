local attributes = {
  addr = 'quickfix',
  bang = true,
  nargs = 1,
  complete = 'command',
  bar = false,
}

local function execute(cmd)
  return function(opts)
    vim.cmd [[cclose | tabnew]]
    local bufnr = vim.api.nvim_get_current_buf()
    vim.cmd(string.format('%s %s | update | cclose', cmd, opts.fargs[1]))
    vim.api.nvim_buf_delete(bufnr, { force = false })
  end
end

attributes.desc = ':cdo on steriods!'
vim.api.nvim_create_user_command('Cdo', execute 'cdo', attributes)

attributes.desc = ':cfdo on steriods!'
vim.api.nvim_create_user_command('Cfdo', execute 'cfdo', attributes)
