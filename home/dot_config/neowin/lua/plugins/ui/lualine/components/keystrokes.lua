return {
  function()
    return require('noice').api.status.command.get()
  end,

  cond = function()
    local ok, noice = pcall(require, 'noice')
    return ok and noice.api.status.command.has()
  end,
}
