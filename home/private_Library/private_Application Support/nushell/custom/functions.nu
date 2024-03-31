# use when "Activity Monitor" starts acting weird
def "restart activity-monitor" []: nothing -> nothing {
  rm ~/Library/Preferences/com.apple.ActivityMonitor.plist
}

# restart touchbar processes
def "restart touchbar" []: nothing -> nothing {
  sudo pkill TouchBarServer
  sudo killall ControlStrip
}

# apply system settings immediately without restarting the computer
def "system-settings apply" []: nothing -> nothing {
  osascript -e 'tell application "System Preferences" to quit'
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
}

# show all the work done from 10am till now
def "show work-done today" []: nothing -> nothing {
  git log --stat --relative-date --since=10am --author=(git config --get user.name)
}

# the cat command on steroids!
def c [file: path]: nothing -> nothing {
  let extension = ($file | path parse | get extension | to text)
  let mime = (file --mime-type -b $file | to text)
  let allowed_mimes = [image/png image/svg+xml]

  if $mime in $allowed_mimes {
    kitten icat $file
  } else if $extension =~ "plist" {
    plutil -convert xml1 -o - $file
  } else {
    bat $file
  }
}
