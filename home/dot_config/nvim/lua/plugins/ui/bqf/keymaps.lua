local M = {}

-- ref: https://github.com/kevinhwang91/nvim-bqf#function-table
function M.qf_keys()
  return {
    open = '',
    openc = '',

    drop = '',
    tabdrop = '',

    tab = 't',
    tabb = 'T',
    tabc = '',

    split = 's',
    vsplit = 'v',

    prevfile = '[[',
    nextfile = ']]',

    prevhist = '[q',
    nexthist = ']q',

    lastleave = '',

    stoggleup = '>',
    stoggledown = '.',
    stogglevm = '',
    stogglebuf = '',
    sclear = 'z.',

    pscrollup = '<M-u>',
    pscrolldown = '<M-d>',
    pscrollorig = 'zo',

    ptogglemode = '',
    ptoggleitem = 'p',
    ptoggleauto = 'P',

    filter = 'zn',
    filterr = 'zN',
    fzffilter = '',
  }
end

return M
