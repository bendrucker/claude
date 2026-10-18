# Sourced by a fixture with the origin URL: starts the repository the session works in.
# commit DATE MESSAGE and commit_as NAME EMAIL DATE MESSAGE stage everything, commit at a fixed
# date so SHAs repeat across runs, and print the new SHA.
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin "$1"

commit_as() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
  git rev-parse HEAD
}

commit() {
  commit_as "Ben Drucker" bvdrucker@gmail.com "$@"
}
