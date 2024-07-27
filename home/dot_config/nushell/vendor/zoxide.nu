export-env {
  $env.__zoxide_hooked = true

  # Initialize hook to add new entries to the database.
  add-hook hooks.env_change.PWD { |_, dir| zoxide add -- $dir }
}

def --env add-hook [field: cell-path, new_hook: any] {
  let old_config = $env.config? | default {}
  let old_hooks = $old_config | get $field --ignore-errors | default []

  $env.config = ($old_config | upsert $field ($old_hooks ++ $new_hook))
}

# Jump to a directory using only keywords.
export def --env __zoxide_z [...rest: string] {
  let arg0 = ($rest | append "~").0
  let path = if (($rest | length) <= 1) and ($arg0 == "-" or ($arg0 | path expand | path type) == dir) {
    $arg0
  } else {
    (zoxide query --exclude $env.PWD -- ...$rest | str trim -r -c "\n")
  }

  cd $path
}

# Jump to a directory using interactive search.
export def --env __zoxide_zi [...rest: string] {
  cd $"(zoxide query --interactive -- ...$rest | str trim -r -c "\n")"
}
