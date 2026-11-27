# Sourced by a fixture after its last commit. The session's Bash can't write the working tree or
# .git, so instead of grading a push this starts a watcher outside the sandbox. Whenever a file in
# the working tree changes, the watcher copies the tree aside and runs the case's check on the
# copy, writing one verdict line per check to .git/eval/verdicts, which the
# `{ source: file, path: .git/eval/verdicts }` graders read after the run.
#
# The fixture writes its check to "$eval_dir/check", which gets the copied tree and a pristine
# snapshot of the fixture commit as arguments, then calls start_grading.
eval_dir=$PWD/.git/eval
mkdir -p "$eval_dir/pristine"
git archive HEAD | tar -x -C "$eval_dir/pristine"

start_grading() {
  chmod +x "$eval_dir/check"
  cat > "$eval_dir/watch" <<'SH'
#!/usr/bin/env bash
eval_dir=$1
work=$2
last=""
end=$((SECONDS + 3600))
while [ -d "$work" ] && [ "$SECONDS" -lt "$end" ]; do
  sig=$(cd "$work" && find . -path ./.git -prune -o -path ./node_modules -prune -o -type f -printf '%P %s %T@\n' 2>/dev/null | sort | md5sum)
  if [ "$sig" != "$last" ]; then
    last=$sig
    tree="$eval_dir/tree"
    rm -rf "$tree" "$eval_dir/scratch"
    mkdir -p "$tree" "$eval_dir/scratch"
    (cd "$work" && tar -c --exclude=./.git --exclude=./node_modules .) | tar -x -C "$tree" 2>/dev/null
    if [ -d "$work/node_modules" ]; then ln -s "$work/node_modules" "$tree/node_modules"; fi
    (cd "$tree" && SCRATCH="$eval_dir/scratch" timeout 120 "$eval_dir/check" "$tree" "$eval_dir/pristine") > "$eval_dir/verdicts.next" 2> "$eval_dir/check.log"
    mv "$eval_dir/verdicts.next" "$eval_dir/verdicts"
  fi
  sleep 1
done
SH
  chmod +x "$eval_dir/watch"
  (setsid nohup bash "$eval_dir/watch" "$eval_dir" "$PWD" > /dev/null 2>&1 < /dev/null &)
  for _ in $(seq 60); do
    [ -s "$eval_dir/verdicts" ] && return 0
    sleep 1
  done
  echo "grading watcher wrote no verdicts" >&2
  return 1
}
