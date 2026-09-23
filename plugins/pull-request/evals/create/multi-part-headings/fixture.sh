#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/mcp-gateway.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p src/auth
cat > src/auth/callback.ts <<'TS'
import { exchange, registerClient } from "./oauth";

export async function callback(req: Request): Promise<Response> {
  const code = new URL(req.url).searchParams.get("code");
  const client = await registerClient();
  const token = await exchange(client.id, code!);
  return new Response(JSON.stringify(token));
}
TS
cat > src/auth/errors.ts <<'TS'
export function isAuthError(err: { status: number; message: string }): boolean {
  return err.status >= 400 && err.message.includes("auth");
}
TS
cat > src/auth/oauth.ts <<'TS'
export async function registerClient(): Promise<{ id: string }> {
  const res = await fetch("https://auth.example.com/register", { method: "POST" });
  return res.json();
}

export async function exchange(clientId: string, code: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch("https://auth.example.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, code, grant_type: "authorization_code" }),
  });
  return res.json();
}
TS
cat > src/auth/retry.ts <<'TS'
import { isAuthError } from "./errors";

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isAuthError(err as { status: number; message: string }) || i >= attempts - 1) throw err;
    }
  }
}
TS
git add -A && git commit -qm "auth: add oauth callback"
git switch -qc auth-callback
cat > src/auth/callback.ts <<'TS'
import { loadClient, saveClient } from "./client-store";
import { exchange, registerClient } from "./oauth";

export async function callback(req: Request): Promise<Response> {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });
  const client = (await loadClient()) ?? (await saveClient(await registerClient()));
  return Response.json(await exchange(client.id, code));
}
TS
cat > src/auth/errors.ts <<'TS'
export function isAuthError(err: { status: number; message: string }): boolean {
  return err.status === 401 || err.status === 403;
}
TS
cat > src/auth/client-store.ts <<'TS'
import { readFile, writeFile } from "node:fs/promises";

const path = ".gateway/client.json";

export async function loadClient(): Promise<{ id: string } | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

export async function saveClient(client: { id: string }): Promise<{ id: string }> {
  await writeFile(path, JSON.stringify(client));
  return client;
}
TS
git add -A && git commit -qm "auth: persist dcr client and narrow auth errors"
