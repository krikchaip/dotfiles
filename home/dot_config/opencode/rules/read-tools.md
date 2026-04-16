---
tools:
  - bash
---

Prefer these commands (run via `bash` tool) for file reading and search.

- **`read`** — Read files
- **`grep`** — Search contents
- **`find`** — Find files
- **`ls`** — Directory listing

```bash
# Read a single file
read ./src/main.ts

# Read multiple files at once
read ./src/main.ts ./src/utils.ts

# Read with line numbers
read -n ./src/main.ts

# Read only the last 50 lines (e.g. logs)
read --tail-lines 50 ./app.log

# Read with aggressive filtering (strip comments, blanks, boilerplate)
read -l aggressive ./src/main.ts

# Search for a pattern (uses ripgrep under the hood)
grep "TODO" ./src/

# Search case-insensitively
grep "error" ./ -i

# Search only TypeScript files
grep "useState" ./ -t ts

# Search with surrounding context lines
grep "export default" ./ -A 3

# Find files by name
find ./ -name "*.ts"

# Find only directories
find ./ -type d -name "components"

# List directory (token-optimized output)
ls ./src/

# List with all flags passed through to native ls
ls -lah ./src/
```
