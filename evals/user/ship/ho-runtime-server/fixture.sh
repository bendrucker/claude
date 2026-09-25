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
{ "name": "links", "type": "module", "scripts": { "start": "bun src/server.ts", "test": "bun test" } }
JSON
cat > src/server.ts <<'TS'
const links = new Map<string, string>([["gh", "https://github.com"]]);

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(req) {
    const target = links.get(new URL(req.url).pathname.slice(1));
    return target ? Response.redirect(target, 302) : new Response("not found", { status: 404 });
  },
});
TS
git add -A && git commit -qm "links: redirect server"
git push -qu origin main
git switch -qc health-route
cat > src/server.ts <<'TS'
const links = new Map<string, string>([["gh", "https://github.com"]]);
const started = Date.now();

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/healthz") {
      return Response.json({ ok: true, links: links.size, uptimeMs: Date.now() - started });
    }
    const target = links.get(path.slice(1));
    return target ? Response.redirect(target, 302) : new Response("not found", { status: 404 });
  },
});
TS
git commit -qam "links: add a health route"
