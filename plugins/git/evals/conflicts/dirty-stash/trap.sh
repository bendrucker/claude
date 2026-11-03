set -euo pipefail
case_dir=$1
copy() { (cd "$1" && find . -type f) | while read -r file; do mkdir -p "$(dirname "$file")"; cp "$1/$file" "${file%.fixture}"; done; }
copy "$case_dir/resolved"
git add -A
GIT_EDITOR=true git rebase --continue > /dev/null
