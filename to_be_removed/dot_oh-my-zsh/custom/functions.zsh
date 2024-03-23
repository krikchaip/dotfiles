#** uses when "Activity Monitor" acting weird
restart-activity-monitor() {
  rm ~/Library/Preferences/com.apple.ActivityMonitor.plist
}

#** restart touchbar processes
restart-touchbar() {
  sudo pkill TouchBarServer
  sudo killall ControlStrip
}

#** apply system settings immediately without restarting computer
apply-settings() {
  osascript -e 'tell application "System Preferences" to quit'
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
}

#** show git commits from 10am till now
what-have-i-done-today() {
  git log --stat \
    --relative-date --since="10am" \
    --author="$(git config --get user.name)"
}
