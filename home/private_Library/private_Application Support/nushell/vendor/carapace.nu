export-env {
  $env.PATH = ($env.PATH | prepend ($env.HOME | path join "Library" "Application Support" "carapace" "bin"))
}

export def main [] {
  return {|spans|
    # if the current command is an alias, get it's expansion
    let expanded_alias = (scope aliases | where name == $spans.0 | get -i 0 | get -i expansion)

    # overwrite
    let spans = (if $expanded_alias != null  {
      # put the first word of the expanded alias first in the span
      $spans | skip 1 | prepend ($expanded_alias | split row " " | take 1)
    } else {
      $spans
    })

    carapace $spans.0 nushell ...$spans | from json
  }
}
