git switch -q -c other-topic
echo "- idea: cache results" >> NOTES.md
git stash push --quiet --message "wip from another session"
git switch -q -
git branch -q -D other-topic
