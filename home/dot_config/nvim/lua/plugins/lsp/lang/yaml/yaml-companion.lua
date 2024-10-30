return {
  -- Spec Source
  'someone-stole-my-name/yaml-companion.nvim',
  name = 'yaml-companion',

  -- Spec Loading
  dependencies = { 'lspconfig', 'telescope' },

  -- Spec Setup
  config = function()
    local settings = {
      yaml = {
        validate = true,
        hover = true,
        completion = true,

        -- this has already been taken care of by prettier
        format = { enable = false },

        -- disable the built-in schemaStore and use the plugin
        schemaStore = { enable = false, url = '' },

        schemas = require('schemastore').yaml.schemas {
          -- each item has to match the `name` attribute in the `catalog`
          -- ref: https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/api/json/catalog.json
          select = { 'docker-compose.yml' },

          -- additional schemas (not in the `catalog`)
          extra = {},

          -- replace certain schemas from the catalog
          replace = {},
        },
      },
    }

    local server_config = require('plugins.lsp.lspconfig.utils').server_config
    local config = require('yaml-companion').setup {
      -- schemas available in Telescope picker
      schemas = {
        {
          name = 'docker-compose.yml',
          uri = 'https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json',
        },
      },

      -- additional options that will be merged in the final LSP config
      lspconfig = vim.tbl_extend('force', server_config, { settings = settings }),
    }

    require('lspconfig').yamlls.setup(config)
    require('telescope').load_extension 'yaml_schema'
  end,

  -- Spec Lazy Loading
  ft = {
    'yaml',
    'yaml.docker-compose',
    'yaml.gitlab',
  },
}
