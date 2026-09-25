#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src
cat > package.json <<'JSON'
{ "name": "slugger", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/slug.ts <<'TS'
export function slugify(input: string, separator = "-"): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "");
}
TS
cat > README.md <<'MD'
# slugger

Turns titles into URL slugs.
MD
git add -A && git commit -qm "slugger: initial"
git push -qu origin main
git switch -qc readme-usage
cat > README.md <<'MD'
# slugger

Turns titles into URL slugs.

## Usage

```ts
import { slugify } from "slugger";

slugify("Hello, World!"); // "hello-world"
slugify("Hello, World!", "_"); // "hello_world"
```

## Options

The second argument sets the separator. It defaults to `-`. Accented letters are decomposed first, so `Café` becomes `cafe`.
MD
git commit -qam "readme: document usage and the separator option"
