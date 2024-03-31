#!/bin/bash

# On the first change:
#   - `defaults read > /tmp/before`
#   - make changes in the system preferences
#   - `defaults read > /tmp/after`
#   - `code --diff /tmp/before /tmp/after`

# On subsequent changes:
#   - make changes in the system preferences
#   - `mv /tmp/after /tmp/before; defaults read > /tmp/after; code --diff /tmp/before /tmp/after`

#** XML template for com.apple.symbolichotkeys -> AppleSymbolicHotKeys
function key-disable() {
  local TEMPLATE="<dict><key>enabled</key><false/></dict>"
  echo "$TEMPLATE"
}

#** XML template for com.apple.symbolichotkeys -> AppleSymbolicHotKeys
function key-combo() {
  local TEMPLATE="
    <dict>
      <key>enabled</key><true/>
      <key>value</key><dict>
        <key>type</key><string>standard</string>
        <key>parameters</key>
        <array>
          <integer>$1</integer>
          <integer>$2</integer>
          <integer>$3</integer>
        </array>
      </dict>
    </dict>
  "
  echo "$TEMPLATE"
}

#** Close any open System Preferences panes, to prevent them from overriding
#** settings we’re about to change
osascript -e 'tell application "System Preferences" to quit'

#** Ask for the administrator password upfront
# sudo -v

#** Keep-alive: update existing `sudo` time stamp until `.macos` has finished
# while true; do
#   sudo -n true
#   sleep 60
#   kill -0 "$$" || exit
# done 2>/dev/null &

#**************************************************************#
#***************** [Global Configurations] ********************#
#**************************************************************#

#** Appearance > Appearance = Dark
defaults write -g AppleInterfaceStyle Dark

#** Accessibility > Display > Reduce motion = ✅
defaults write com.apple.Accessibility ReduceMotionEnabled -bool true

#** Accessibility > Pointer Control > Double-click speed
defaults write -g com.apple.mouse.doubleClickThreshold -float 0.5

#** Accessibility > Pointer Control > Sprint-loading = ✅
defaults write -g com.apple.springing.enabled -bool true

#** Accessibility > Pointer Control > Sprint-loading speed
defaults write -g com.apple.springing.delay -float 0.5

#** Desktop & Dock > Dock > Size
defaults write com.apple.dock tilesize -int 27

#** Desktop & Dock > Dock > Magnification
defaults write com.apple.dock largesize -int 16

#** Desktop & Dock > Dock > Position on screen
defaults write com.apple.dock orientation left

#** Desktop & Dock > Dock > Minimize windows into application icon
defaults write com.apple.dock minimize-to-application -bool false

#** Desktop & Dock > Dock > Show indicators for open applications
defaults write com.apple.dock show-process-indicators -bool true

#** Desktop & Dock > Desktop & Stage Manager > Click wallpaper to reveal desktop = ❌
defaults write com.apple.WindowManager EnableStandardClickToShowDesktop -bool false

#** Desktop & Dock > Mission Control > Automatically rearrange Spaces based on most recent use
defaults write com.apple.dock mru-spaces -bool false

#** Desktop & Dock > Mission Control > Switch to a space with open windows for the application
defaults write -g AppleSpacesSwitchOnActivate -bool true

#** Desktop & Dock > Mission Control > Displays have separate Spaces
defaults write com.apple.spaces spans-displays -bool false

#** Keyboard > Key repeat rate
defaults write -g KeyRepeat -float 2

#** Keyboard > Delay until repeat
defaults write -g InitialKeyRepeat -float 15

#** Keyboard > Touch Bar Settings > Touch Bar Shows = App Controls & Show Control Strip = ✅
defaults write com.apple.touchbar.agent PresentationModeGlobal appWithControlStrip

#** Keyboard > Touch Bar Settings > Press and hold fn key to = Show F# keys
defaults write com.apple.touchbar.agent PresentationModeFnModes -dict-add "appWithControlStrip" -string "functionKeys"

#** Keyboard > Touch Bar Settings > Show typing suggestions
defaults write -g NSAutomaticTextCompletionEnabled -bool false

#** Keyboard > Touch Bar Settings > Customize Control Strip...
defaults write com.apple.controlstrip MiniCustomized -array \
  "com.apple.system.show-desktop"
defaults write com.apple.controlstrip FullCustomized -array \
  "com.apple.system.group.brightness" \
  "NSTouchBarItemIdentifierFlexibleSpace" \
  "com.apple.system.mission-control" \
  "com.apple.system.launchpad" \
  "NSTouchBarItemIdentifierFlexibleSpace" \
  "com.apple.system.screencapture" \
  "com.apple.system.sleep" \
  "NSTouchBarItemIdentifierFlexibleSpace" \
  "com.apple.system.group.media" \
  "com.apple.system.group.volume"

#** Keyboard > Keyboard Shortcuts... > Launchpad & Dock > Turn Dock hiding on/off = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 52 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Launchpad & Dock > Show Launchpad = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 160 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Display > Decrease display brightness = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 53 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Display > Increase display brightness = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 54 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Mission Control = ctrl + cmd + up
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 32 "$(key-combo 65535 126 11796480)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Application windows = ctrl + cmd + down
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 33 "$(key-combo 65535 125 11796480)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Show Desktop = F11
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 36 "$(key-combo 65535 103 8388608)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Move left a space = ctrl + cmd + left
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 79 "$(key-combo 65535 123 11796480)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Move right a space = ctrl + cmd + right
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 81 "$(key-combo 65535 124 11796480)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 1 = ctrl + cmd + 1
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 118 "$(key-combo 49 18 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 2 = ctrl + cmd + 2
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 119 "$(key-combo 50 19 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 3 = ctrl + cmd + 3
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 120 "$(key-combo 51 20 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 4 = ctrl + cmd + 4
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 121 "$(key-combo 52 21 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 5 = ctrl + cmd + 5
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 122 "$(key-combo 53 23 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 6 = ctrl + cmd + 6
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 123 "$(key-combo 54 22 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 7 = ctrl + cmd + 7
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 124 "$(key-combo 55 26 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 8 = ctrl + cmd + 8
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 125 "$(key-combo 56 28 1310720)"

#** Keyboard > Keyboard Shortcuts... > Mission Control > Switch to Desktop 9 = ctrl + cmd + 9
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 126 "$(key-combo 57 25 1310720)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Change the way Tab moves focus = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 13 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Turn keyboard access on or off = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 12 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to the menu bar = ctrl + cmd + shift + h
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 7 "$(key-combo 104 4 1441792)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to the Dock = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 8 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to active or next window = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 9 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to the window toolbar = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 10 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to the floating window = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 11 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to next window = cmd + `
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 27 "$(key-combo 96 50 1048576)"

#** Keyboard > Keyboard Shortcuts... > Keyboard > Move focus to status menu = ctrl + cmd + shift + l
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 57 "$(key-combo 108 37 1441792)"

#** Keyboard > Keyboard Shortcuts... > Input Sources > Select the previous input source = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 60 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > Input Sources > Select next source in Input menu = cmd + space
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 61 "$(key-combo 32 49 1048576)"

#** Keyboard > Keyboard Shortcuts... > Spotlight > Show Spotlight search = opt + space
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 64 "$(key-combo 32 49 524288)"

#** Keyboard > Keyboard Shortcuts... > Spotlight > Show Finder search window = ❌
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 65 "$(key-disable)"

#** Keyboard > Keyboard Shortcuts... > App Shortcuts > Stickies > Strikethrough = cmd + shift + s
defaults write com.apple.Stickies NSUserKeyEquivalents -dict-add "Strikethrough" -string "@\$s"

#** Mouse > Tracking speed
defaults write -g com.apple.mouse.scaling -float 3

#** Trackpad > Point & Click > Tracking speed = Fast
defaults write -g com.apple.trackpad.scaling -float 3

#** Trackpad > Point & Click > Click = Firm
defaults write com.apple.AppleMultitouchTrackpad FirstClickThreshold -int 0
defaults write com.apple.AppleMultitouchTrackpad SecondClickThreshold -int 0

#** Trackpad > Point & Click > Force Click and haptic feedback = ❌
defaults write com.apple.AppleMultitouchTrackpad ActuateDetents -int 0
defaults write com.apple.AppleMultitouchTrackpad ForceSuppressed -bool true

#** Trackpad > Point & Click > Look up & data detectors = ✅
defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerTapGesture -int 2
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadThreeFingerTapGesture -int 2

#** Trackpad > Point & Click > Secondary click = Click or Tap with Two Fingers
defaults write com.apple.AppleMultitouchTrackpad TrackpadRightClick -bool true
defaults write com.apple.AppleMultitouchTrackpad TrackpadCornerSecondaryClick -int 0

#** Trackpad > Point & Click > Tap to click = ✅
defaults write com.apple.AppleMultitouchTrackpad Clicking -bool true
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool true

#** Trackpad > Scroll & Zoom > Natural scrolling = ✅
defaults write -g com.apple.swipescrolldirection -bool true

#** Trackpad > Scroll & Zoom > Zoom in or out = ✅
defaults write com.apple.AppleMultitouchTrackpad TrackpadPinch -bool true
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadPinch -bool true

#** Trackpad > Scroll & Zoom > Smart zoom = ❌
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadTwoFingerDoubleTapGesture -int 0

#** Trackpad > Scroll & Zoom > Rotate = ✅
defaults write com.apple.AppleMultitouchTrackpad TrackpadRotate -bool true
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadRotate -bool true

#** Trackpad > More Gestures > Swipe between pages = ❌
defaults write -g AppleEnableSwipeNavigateWithScrolls -bool false

#** Trackpad > More Gestures > Swipe between full-screen applications = Swipe Left or Right with Three Fingers
defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerHorizSwipeGesture -int 2
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadThreeFingerHorizSwipeGesture -int 2

#** Trackpad > More Gestures > Notification Center = ✅
defaults write com.apple.AppleMultitouchTrackpad TrackpadTwoFingerFromRightEdgeSwipeGesture -int 3
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadTwoFingerFromRightEdgeSwipeGesture -int 3

defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerVertSwipeGesture -int 2
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadThreeFingerVertSwipeGesture -int 2

#** Trackpad > More Gestures > Mission Control = Swipe Up with Three Fingers
defaults write com.apple.dock showMissionControlGestureEnabled -bool true

#** Trackpad > More Gestures > App Expose = Swipe Down with Three Fingers
defaults write com.apple.dock showAppExposeGestureEnabled -bool true

#** Trackpad > More Gestures > Launchpad = Pinch with thumb and three fingers
defaults write com.apple.dock showLaunchpadGestureEnabled -bool true

#** Trackpad > More Gestures > Show Desktop = Spread with thumb and three fingers
defaults write com.apple.dock showDesktopGestureEnabled -bool true

#**************************************************************#
#*************** [Application Configurations] *****************#
#**************************************************************#

#** enable repeat keys for VSCode (Vim extension)
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
