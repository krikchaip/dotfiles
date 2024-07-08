local cmp = require 'cmp'

local M = {}

-- Enable mapping in all modes
function M.ics(mapping_fn)
  return cmp.mapping(mapping_fn, { 'i', 'c', 's' })
end

-- Enable mapping except command mode
function M.is(mapping_fn)
  return cmp.mapping(mapping_fn, { 'i', 's' })
end

-- Enable mapping for only command mode
function M.c(mapping_fn)
  return cmp.mapping(mapping_fn, { 'c' })
end

return M
