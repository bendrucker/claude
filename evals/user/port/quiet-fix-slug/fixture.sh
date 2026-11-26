#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p bin
cat > package.json <<'JSON'
{ "name": "release-tools", "type": "module", "private": true }
JSON
cat > bin/slug <<'BASH'
#!/usr/bin/env bash
# Turn a title into a URL slug.
set -euo pipefail
echo "$*" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
BASH
chmod +x bin/slug
cat > bin/tag-release <<'BASH'
#!/usr/bin/env bash
# Tag the current commit for a named release: "Spring Sale" -> spring-sale-2026-11-26
set -euo pipefail
git tag "$(bin/slug "$1")$(date +%F)"
BASH
chmod +x bin/tag-release
git add -A && git commit -qm "release: slug and tag helpers"
