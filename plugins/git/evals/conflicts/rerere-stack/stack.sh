set -euo pipefail
case_dir=$1
copy() { (cd "$1" && find . -type f) | while read -r file; do mkdir -p "$(dirname "$file")"; cp "$1/$file" "${file%.fixture}"; done; }
side=$2
copy "$case_dir/resolved/a"
git add -A
GIT_EDITOR=true git rebase --continue > /dev/null
git rebase --onto connect-timeout origin/connect-timeout read-timeout > /dev/null 2>&1 || true
copy "$case_dir/$side/b"
git add -A
GIT_EDITOR=true git rebase --continue > /dev/null
git push --quiet --force-with-lease origin connect-timeout read-timeout
