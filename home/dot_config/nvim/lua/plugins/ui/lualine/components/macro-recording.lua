return {
  function()
    return require('noice').api.status.mode.get()
  end,

  cond = function()
    local ok, noice = pcall(require, 'noice')
    return ok and noice.api.status.mode.has()
  end,
}
