---
tools:
  - bash
---

Prefer `rtk` CLI wrapped bash commands for local file reading and search to maximize token savings. ALWAYS use `rtk ripgrep` instead of `rtk grep` for better performance.

These commands (`read`, `ls`, `find`, `ripgrep`) are part of the `rtk` suite, designed to produce token-optimized output.

```bash
$ rtk read ./path/to/file  # Read files
$ rtk ripgrep "package" ./ # Search contents (RIPGREP not GREP)
$ rtk find ./              # Find files
$ rtk ls ./path/to/file    # Directory listing
```

Example usage:

```bash
# Read a single file
rtk read ./src/main.ts

# Read multiple files at once
rtk read ./src/main.ts ./src/utils.ts

# Read with line numbers
rtk read -n ./src/main.ts

# Read only the last 50 lines (e.g. logs)
rtk read --tail-lines 50 ./app.log

# Read with aggressive filtering (strip comments, blanks, boilerplate)
rtk read -l aggressive ./src/main.ts

# Search for a pattern
rtk ripgrep "TODO" ./src/

# Search case-insensitively
rtk ripgrep "error" ./ -i

# Search only TypeScript files
rtk ripgrep "useState" ./ -t ts

# Search with surrounding context lines
rtk ripgrep "export default" ./ -A 3

# Find files by name
rtk find ./ -name "*.ts"

# Find only directories
rtk find ./ -type d -name "components"

# List directory (token-optimized output)
rtk ls ./src/

# List with all flags passed through to native ls
rtk ls -lah ./src/
```
