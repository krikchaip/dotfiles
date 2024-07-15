return {
  function()
    return require('noice').api.status.command.get()
  end,

  cond = function()
    return require('noice').api.status.command.has()
  end,
}
