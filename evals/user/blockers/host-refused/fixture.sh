#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
cat > package.json <<'JSON'
{ "name": "storefront", "private": true, "dependencies": { "@acme/ui": "4.2.0", "react": "19.1.0" } }
JSON
echo "@acme:registry=https://registry.acme.internal/" > .npmrc
stubs="$HOME/.blockers-stubs"
mkdir -p "$stubs"
cat > "$stubs/npm" <<'NPM'
#!/usr/bin/env bash
if [[ "$*" == *"@acme/"* ]] || [[ "$*" == "install"* ]] || [[ "$*" == "outdated"* ]]; then
  echo "npm error code E403" >&2
  echo "npm error 403 Forbidden - GET https://registry.acme.internal/@acme%2fui - request blocked: no rule allows host registry.acme.internal" >&2
  exit 1
fi
echo "npm: offline" >&2
exit 1
NPM
chmod +x "$stubs/npm"
for rc in "$HOME/.bashrc" "$HOME/.zshenv"; do echo "export PATH=\"$stubs:\$PATH\"" >> "$rc"; done
