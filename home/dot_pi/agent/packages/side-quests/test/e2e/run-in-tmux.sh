#!/bin/sh
set -eu

expect_script=$1
mode=$2
extension=$3
work_dir=$4
state_dir=$5
log_path=$6
status_path=$7

set +e
"$expect_script" "$mode" "$extension" "$work_dir" "$state_dir" "$log_path"
status=$?
printf '%s\n' "$status" > "$status_path"
exit "$status"
