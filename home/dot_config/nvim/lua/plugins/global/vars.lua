-- Nushell config paths
vim.g.nu_config_path = '~/Library/Application Support/nushell/config.nu'
vim.g.nu_env_path = '~/Library/Application Support/nushell/env.nu'

-- Disable some default providers
vim.g.loaded_node_provider = 0
vim.g.loaded_python3_provider = 0
vim.g.loaded_perl_provider = 0
vim.g.loaded_ruby_provider = 0

-- Disable netrw at the very start
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1
