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
def "apply system-settings" []: nothing -> nothing {
  osascript -e 'tell application "System Preferences" to quit'
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
}

# show all the work done from 10am till now
def "git work-done today" []: nothing -> nothing {
  git log --stat --relative-date --since=10am --author=(git config --get user.name)
}
