return {
  function()
    return require('noice').api.status.mode.get()
  end,

  cond = function()
    return require('noice').api.status.mode.has()
  end,
}
