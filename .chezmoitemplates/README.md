# `chezmoi` templates

> `chezmoi` will interpret all the files in this directory or its subdirectories as templates.

## Show template data (variable)

```sh
chezmoi data
```

## Testing templates

```sh
# as template literal
chezmoi execute-template '...some golang template literal'

# as template file
chezmoi execute-template < /path/to/template
```
