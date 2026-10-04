#!/bin/sh
set -eu
account=${1:-}
repo=${2:-.}
case "$account" in
  ming) name=Ming; email=m1n9x1x1@gmail.com; host=github-ming; username=M1ingx1xx1; key="$HOME/.ssh/id_ed25519_github_M1ingx1xx1" ;;
  han) name='Yunhan Huang'; email=yunhanhuang.han@gmail.com; host=github.com; username=theUpperHan; key="$HOME/.ssh/id_ed25519_github_theUpperHan" ;;
  *) echo 'Usage: switch-github.sh ming|han [repository-path]' >&2; exit 2 ;;
esac
if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a Git repository: $repo. Use make $account REPO=/absolute/repository/path" >&2
  exit 1
fi
[ -f "$key" ] || { echo "Missing SSH key: $key" >&2; exit 1; }
# Git credentials belong to the repository, never to the global config.
git -C "$repo" config --local user.name "$name"
git -C "$repo" config --local user.email "$email"
# Update explicit fetch and push URLs, keeping repository ownership unchanged.
git -C "$repo" remote | while IFS= read -r remote; do
  for field in url pushurl; do
    config_key="remote.$remote.$field"
    git -C "$repo" config --local --get-all "$config_key" | while IFS= read -r url; do
      case "$url" in
        git@github.com:*|git@github-upperhan:*|git@github-ming:*) path=${url#*:} ;;
        https://github.com/*) path=${url#https://github.com/} ;;
        ssh://git@github.com/*|ssh://git@github-upperhan/*|ssh://git@github-ming/*) path=${url#ssh://git@}; path=${path#*/} ;;
        *) continue ;;
      esac
      git -C "$repo" config --local --fixed-value --replace-all "$config_key" "git@$host:$path" "$url"
    done
  done
done
printf 'GitHub SSH account: %s\nCommit author: %s <%s>\n' "$username" "$name" "$email"
git -C "$repo" remote -v
