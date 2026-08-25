#!/usr/bin/env nu

const tool = "npm:@earendil-works/pi-coding-agent"

def main [
  target: string
  --apply
] {
  let selection = $"($tool)@($target)"

  if $apply {
    mise use --global --pin $selection
  } else {
    mise use --global --pin $selection --dry-run
  }
}
