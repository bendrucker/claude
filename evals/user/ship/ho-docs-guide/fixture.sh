#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src docs
cat > package.json <<'JSON'
{ "name": "notes-api", "type": "module", "scripts": { "start": "bun src/server.ts", "test": "bun test" } }
JSON
cat > src/server.ts <<'TS'
const notes: string[] = [];

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    if (req.method === "POST") notes.push(await req.text());
    return Response.json(notes);
  },
});
TS
cat > CONTRIBUTING.md <<'MD'
# Contributing

Run `bun test` before opening a pull request.
MD
git add -A && git commit -qm "notes-api: initial"
git push -qu origin main
git switch -qc deploy-guide
cat > docs/deploy.md <<'MD'
# Deploying

The server is a single Bun process. Set `PORT` to choose the port, which defaults to 3000.

1. Build the image with `docker build -t notes-api .`.
2. Run it with `docker run -p 3000:3000 notes-api`.

Notes live in memory, so a restart clears them. Put a volume-backed store in front before relying on it.
MD
cat > CONTRIBUTING.md <<'MD'
# Contributing

Run `bun test` before opening a pull request. Changes that affect how the server starts should update [the deploy guide](docs/deploy.md) in the same pull request.
MD
git add -A && git commit -qm "docs: add a deploy guide"
