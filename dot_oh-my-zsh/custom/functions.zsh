REVIEW_DIR="$HOME/.code-review"

#** create a new bash script
create-script() {
  local filename="$1"
  echo '#\!/bin/bash' | tr -d '\' >$filename
  chmod +x $filename
  code $filename
}

#** uses when "Activity Monitor" acting weird
restart-activity-monitor() {
  rm ~/Library/Preferences/com.apple.ActivityMonitor.plist
}

#** restart touchbar processes
restart-touchbar() {
  sudo pkill TouchBarServer
  sudo killall ControlStrip
}

#** continue on code reviewing
review() {
  local branch="$1"
  if [ -d $(readlink -f "$REVIEW_DIR/$branch") ]; then
    code -n "$REVIEW_DIR/$branch"
  fi
}

#** finish code reviewing and remove branch
review-done() {
  local branch="$1"
  git worktree remove "$REVIEW_DIR/$branch"
  git branch -D "$branch"
}

#** start code reviewing
review-start() {
  local branch="$1"
  git worktree add "$REVIEW_DIR/$branch" "$branch"
  code -n "$REVIEW_DIR/$branch"
}

#** show git commits from 10am till now
what-have-i-done-today() {
  git log --stat \
    --relative-date --since="10am" \
    --author="$(git config --get user.name)"
}

#** apply system settings immediately without restarting computer
apply-settings() {
  osascript -e 'tell application "System Preferences" to quit'
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
}
