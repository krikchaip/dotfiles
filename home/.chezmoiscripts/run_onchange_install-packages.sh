#!/bin/bash

# install homebrew
if [ ! "$(command -v brew)" ]; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# brew install nushell
# brew install kitty
