#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p bin
cat > package.json <<'JSON'
{ "name": "notes", "type": "module", "private": true }
JSON
cat > bin/due <<'BASH'
#!/usr/bin/env bash
# List TODO lines with a due date, with days remaining (negative when overdue).
set -euo pipefail
now=$(date +%s)
grep -nE 'TODO\(([0-9]{4}-[0-9]{2}-[0-9]{2})\)' "${1:-TODO.md}" | while IFS= read -r line; do
  due=$(grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' <<<"$line" | head -1)
  days=$(( ($(date -d "$due" +%s) - now) / 86400 ))
  printf '%4d  %s\n' "$days" "${line#*:}"
done
BASH
chmod +x bin/due
cat > TODO.md <<'MD'
# Notes
- TODO(2026-11-01) renew the domain
- TODO(2026-12-15) rotate the deploy key
- TODO(2027-02-01) file taxes
- plain TODO without a date
MD
git add -A && git commit -qm "notes: due report"
