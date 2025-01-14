# use when "Activity Monitor" starts acting weird
def "restart activity-monitor" []: nothing -> nothing {
  rm ~/Library/Preferences/com.apple.ActivityMonitor.plist
}

# restart touchbar processes
def "restart touchbar" []: nothing -> nothing {
  sudo pkill TouchBarServer
  sudo killall ControlStrip
}

# install/reinstall system packages
def "packages install" []: nothing -> nothing {
  open ~/.local/share/chezmoi/home/.chezmoiscripts/run_onchange_install-packages.sh.tmpl
    | chezmoi execute-template
    | bash
}

# identify which values your current configuration has changed from the defaults
# ref: https://www.nushell.sh/blog/2024-12-04-configuration_preview.html#finding-overridden-values
def "nu-config diff" []: nothing -> nothing {
  let defaults = nu -n -c "$env.config = {}; $env.config | reject color_config keybindings menus | to nuon" | from nuon | transpose key default
  let current = $env.config | reject color_config keybindings menus | transpose key current

  $current | merge $defaults | where $it.current != $it.default
}

# apply system settings immediately without restarting the computer
def "system-settings apply" []: nothing -> nothing {
  osascript -e 'tell application "System Preferences" to quit'
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
}

# see the differences of the current system settings, before and after modification
def "system-settings diff" []: nothing -> nothing {
  let files = [/tmp/system-settings.before, /tmp/system-settings.after]

  if ($files | path exists | any { |el| not $el }) {
    return
  }

  code --diff -n ...$files
}

# start comparing system settings. go modify the settings, then run `continue`
def "system-settings diff start" []: nothing -> nothing {
  let files = [/tmp/system-settings.before, /tmp/system-settings.after]
  let content = (defaults read | to text)

  $files | each { |f| rm -f $f; $content | save -f $f }

  return
}

# run this on subsequent changes of the system settings
def "system-settings diff continue" []: nothing -> nothing {
  let files = [/tmp/system-settings.before, /tmp/system-settings.after]

  if ($files | path exists | any { |el| not $el }) {
    system-settings diff start
    print "Some cache files are missing, modify the settings and then run this again!"

    return
  }

  mv $files.1 $files.0
  defaults read | save -f $files.1
}

# remove all nvim artifacts. restore nvim to its original state
def "restore-factory nvim" [app_name: string = "nvim"]: nothing -> nothing {
  let artifact_paths = [
    ~/.cache/
    ~/.config/
    ~/.local/share/
    ~/.local/state/
  ]

  # fix `rm` not working with relative path
  # ref: https://github.com/nushell/nushell/issues/11061#issuecomment-1812749880
  for p in $artifact_paths {
    let absolute_path =  ($p | path join $app_name | path expand)

    rm -rf $absolute_path
    print $"\(removed\) ($absolute_path)"
  }
}

# show all the work done from 10am till now
def "show work-done today" []: nothing -> nothing {
  git log --stat --relative-date --since=10am --author=(git config --get user.name)
}

# fuzzily search command aliases using fzf
def "fuzzy aliases" [...query: string]: nothing -> any {
  help aliases
    | to tsv --columns=[name expansion]
    | (fzf --header-lines=1
           --delimiter="\t+"
           --query=$"($query | str join ' ')"
           --bind=$"enter:become[($env.FZF_SHELL) {1}]"
           --bind=$"double-click:become[($env.FZF_SHELL) {1}]")
}

# interactively list items inside the current directory using fzf
def "fuzzy ls" []: nothing -> any {
  let fd = ($env.FZF_CTRL_T_COMMAND | append "--exact-depth=1" | str join " ")
  nu -c $"($fd) | fzf ($env.FZF_CTRL_T_OPTS)" | fzf-join
}
