local M = {}

M.json = function()
  return require("schemastore").json.schemas()
end

M.yaml = function()
  return require("schemastore").yaml.schemas()
end

return M
