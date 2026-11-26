set -euo pipefail
case_dir=$1
copy() { (cd "$1" && find . -type f) | while read -r file; do mkdir -p "$(dirname "$file")"; cp "$1/$file" "${file%.fixture}"; done; }
copy "$case_dir/resolved"
git add -- src
git stash push --include-untracked --message "conflicts: eval" -- NOTES.md scratch.txt > /dev/null
sha=$(git stash list --format='%H %gs' | grep 'conflicts: eval' | cut -d' ' -f1)
GIT_EDITOR=true git rebase --continue > /dev/null
git stash apply "$sha" > /dev/null
ref=$(git stash list --format='%gd %gs' | grep 'conflicts: eval' | cut -d' ' -f1)
git stash drop "$ref" > /dev/null
