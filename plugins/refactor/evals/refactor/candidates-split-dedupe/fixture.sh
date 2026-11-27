#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
commit() { git add -A && git commit -qm "$1"; }
mkdir -p src/users src/billing src/data packages/cli-a/src packages/cli-b/src
cat > package.json <<'JSON'
{ "name": "signup", "type": "module", "private": true, "workspaces": ["packages/*"], "scripts": { "test": "bun test" } }
JSON

cat > src/users/signup.ts <<'TS'
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.split("+")[0].replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

export function signup(email: string, users: Set<string>): string {
  const key = normalizeEmail(email);
  if (users.has(key)) throw new Error("already registered");
  users.add(key);
  return key;
}
TS
cat > src/users/invite.ts <<'TS'
function canonicalEmail(raw: string): string {
  const [name, host] = raw.toLowerCase().split("@");
  const domain = host === "googlemail.com" ? "gmail.com" : host;
  if (domain !== "gmail.com") return name + "@" + domain;
  const base = name.includes("+") ? name.slice(0, name.indexOf("+")) : name;
  return base.split(".").join("") + "@" + domain;
}

export function invite(emails: string[]): string[] {
  return [...new Set(emails.map(canonicalEmail))];
}
TS
cat > src/billing/customer.ts <<'TS'
const customerKey = (address: string): string => {
  const lower = address.trim().toLowerCase();
  const i = lower.lastIndexOf("@");
  const domain = lower.slice(i + 1);
  let user = lower.slice(0, i);
  if (domain === "gmail.com") {
    const plus = user.indexOf("+");
    if (plus >= 0) user = user.slice(0, plus);
    user = user.replace(/\./g, "");
  }
  return user + "@" + domain;
};

export function findCustomer(address: string, byKey: Map<string, string>): string | undefined {
  return byKey.get(customerKey(address));
}
TS

for pkg in cli-a cli-b; do
  cat > packages/$pkg/package.json <<JSON
{ "name": "@acme/$pkg", "version": "1.4.0", "type": "module", "bin": { "$pkg": "src/main.ts" }, "dependencies": {} }
JSON
  cat > packages/$pkg/README.md <<MD
# @acme/$pkg

Published to npm on its own. It has zero runtime dependencies, including other packages in this repo, so it installs offline from a single tarball.
MD
  cat > packages/$pkg/src/exit.ts <<'TS'
export class UsageError extends Error {}
export class NotFoundError extends Error {}

export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError) return 2;
  if (err instanceof NotFoundError) return 3;
  if (err instanceof Error && "code" in err && err.code === "EACCES") return 77;
  if (err instanceof Error && "code" in err && err.code === "ENOENT") return 66;
  return 1;
}

export function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(exitCodeFor(err));
}
TS
done
cat > packages/cli-a/src/main.ts <<'TS'
import { fail, UsageError } from "./exit";
try { if (!process.argv[2]) throw new UsageError("usage: cli-a <file>"); } catch (e) { fail(e); }
TS
cat > packages/cli-b/src/main.ts <<'TS'
import { fail, NotFoundError } from "./exit";
try { if (!process.argv[2]) throw new NotFoundError("no such record"); } catch (e) { fail(e); }
TS

{
  echo "export interface Country { code: string; name: string; dial: string; currency: string }"
  echo ""
  echo "export const COUNTRIES: Country[] = ["
  for i in $(seq 1 240); do
    printf '  { code: "C%03d", name: "Country %d", dial: "+%d", currency: "X%02d" },\n' "$i" "$i" "$i" "$((i % 90))"
  done
  echo "];"
  echo ""
  echo "export const byCode = (code: string) => COUNTRIES.find((c) => c.code === code);"
} > src/data/countries.ts

cat > src/server.ts <<'TS'
import { signup } from "./users/signup";
import { invite } from "./users/invite";
import { findCustomer } from "./billing/customer";

export interface Config { port: number; token: string; rateLimit: number; windowMs: number; logLevel: string }

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port)) throw new Error(`bad PORT: ${env.PORT}`);
  return {
    port,
    token: env.API_TOKEN ?? "",
    rateLimit: Number(env.RATE_LIMIT ?? 60),
    windowMs: Number(env.RATE_WINDOW_MS ?? 60_000),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}

const LEVELS = ["debug", "info", "warn", "error"];
export const logLines: string[] = [];

export function log(config: Config, level: string, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(config.logLevel)) return;
  logLines.push(JSON.stringify({ level, msg, ...fields }));
}

const hits = new Map<string, number[]>();

export function allow(config: Config, client: string, now: number): boolean {
  const recent = (hits.get(client) ?? []).filter((t) => now - t < config.windowMs);
  if (recent.length >= config.rateLimit) {
    hits.set(client, recent);
    return false;
  }
  recent.push(now);
  hits.set(client, recent);
  return true;
}

export function resetLimits(): void {
  hits.clear();
}

export function authorized(config: Config, header: string | null): boolean {
  if (!config.token) return true;
  if (!header?.startsWith("Bearer ")) return false;
  const given = header.slice(7);
  if (given.length !== config.token.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ config.token.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderPage(title: string, items: string[]): string {
  const list = items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  return `<!doctype html><title>${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1><ul>${list}</ul>`;
}

export function renderError(status: number, message: string): string {
  return renderPage(`Error ${status}`, [message]);
}

type Handler = (req: Request, config: Config) => Promise<Response> | Response;
export const routes = new Map<string, Handler>();

export function route(method: string, path: string, handler: Handler): void {
  routes.set(`${method} ${path}`, handler);
}

const users = new Set<string>();
const customers = new Map<string, string>();

export function registerRoutes(): void {
  route("POST", "/signup", async (req) => {
    const { email } = (await req.json()) as { email: string };
    return Response.json({ key: signup(email, users) }, { status: 201 });
  });
  route("POST", "/invite", async (req) => {
    const { emails } = (await req.json()) as { emails: string[] };
    return Response.json({ invited: invite(emails) });
  });
  route("GET", "/customer", (req) => {
    const email = new URL(req.url).searchParams.get("email") ?? "";
    const id = findCustomer(email, customers);
    return id ? Response.json({ id }) : new Response(renderError(404, "no customer"), { status: 404 });
  });
  route("GET", "/", () => new Response(renderPage("Signup", [...users]), { headers: { "content-type": "text/html" } }));
}

registerRoutes();

export async function handle(req: Request, config: Config, client: string, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const key = `${req.method} ${url.pathname}`;
  if (!allow(config, client, now)) {
    log(config, "warn", "rate limited", { client, key });
    return new Response(renderError(429, "slow down"), { status: 429 });
  }
  if (req.method !== "GET" && !authorized(config, req.headers.get("authorization"))) {
    log(config, "warn", "unauthorized", { client, key });
    return new Response(renderError(401, "unauthorized"), { status: 401 });
  }
  const handler = routes.get(key);
  if (!handler) return new Response(renderError(404, "not found"), { status: 404 });
  try {
    const res = await handler(req, config);
    log(config, "info", "request", { key, status: res.status });
    return res;
  } catch (err) {
    log(config, "error", "handler failed", { key, error: String(err) });
    return new Response(renderError(500, "internal error"), { status: 500 });
  }
}

if (import.meta.main) {
  const config = loadConfig();
  Bun.serve({ port: config.port, fetch: (req, srv) => handle(req, config, srv.requestIP(req)?.address ?? "?") });
}
TS
cat > src/server.test.ts <<'TS'
import { expect, test } from "bun:test";
import { handle, loadConfig, resetLimits, routes } from "./server";

test("routes register at import", () => expect(routes.size).toBe(4));
test("signup then rate limit", async () => {
  resetLimits();
  const config = { ...loadConfig({}), rateLimit: 1 };
  const req = () => new Request("http://x/signup", { method: "POST", body: JSON.stringify({ email: "A.B+x@Gmail.com" }) });
  expect(await (await handle(req(), config, "c", 0)).json()).toEqual({ key: "ab@gmail.com" });
  expect((await handle(req(), config, "c", 1)).status).toBe(429);
});
TS
commit "signup: server, users, billing"

for change in "server: log rate-limited clients" "server: constant-time token compare" "server: render 404 for unknown customers" "server: configurable rate window" "server: log handler failures"; do
  echo "// $change" >> src/server.ts
  commit "$change"
done
sed -i '/^\/\/ server: /d' src/server.ts
commit "server: drop change notes"
