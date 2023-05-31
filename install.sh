#!/bin/sh

# -e: exit on error
# -u: exit on unset variables
set -eu

if command -v curl >/dev/null; then
	chezmoi_install_script="$(curl -fsSL get.chezmoi.io)"
elif command -v wget >/dev/null; then
	chezmoi_install_script="$(wget -qO- get.chezmoi.io)"
else
	echo "To install chezmoi, you must have curl or wget installed." >&2
	exit 1
fi

sudo sh -c "${chezmoi_install_script}" -- -b /usr/local/bin

env >~/chezmoi.log

chezmoi init --apply
