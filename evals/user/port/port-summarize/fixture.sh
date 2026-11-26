#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p bin logs
cat > package.json <<'JSON'
{ "name": "ops", "type": "module", "private": true }
JSON
cat > bin/summarize <<'BASH'
#!/usr/bin/env bash
# Count log lines by level, most frequent first.
set -euo pipefail
file=${1:--}
if [[ $file != - && ! -r $file ]]; then
  echo "summarize: cannot read $file" >&2
  exit 2
fi
counts=$(grep -oE '^\[[A-Z]+\]' "$file" | tr -d '[]' | sort | uniq -c | sort -k1,1nr -k2,2)
if [[ -z $counts ]]; then
  echo "summarize: no log lines" >&2
  exit 1
fi
printf '%s\n' "$counts"
BASH
chmod +x bin/summarize
cat > logs/app.log <<'LOG'
[INFO] started
[WARN] slow disk
[INFO] request ok
[ERROR] request failed
[INFO] request ok
  [INFO] indented, not counted
[WARN] retry
LOG
cat > bin/nightly <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
bin/summarize logs/app.log | mail -s "nightly log summary" ops@example.com
BASH
chmod +x bin/nightly
git add -A && git commit -qm "ops: log summary"
