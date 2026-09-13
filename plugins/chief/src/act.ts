import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Store } from "./store";
import type { LedgerRow } from "./types";

const DEFAULT_PORT = 7392;
const TOKEN_LENGTH = 24;
const ACTIONABLE_STATES: ReadonlySet<LedgerRow["state"]> = new Set(["open", "pushed"]);

export function actToken(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex").slice(0, TOKEN_LENGTH);
}

export async function ensureActSecret(path: string): Promise<string> {
  const file = Bun.file(path);
  if (await file.exists()) return (await file.text()).trim();

  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, secret);
  return secret;
}

function verify(secret: string, id: string, token: string): boolean {
  const expected = Buffer.from(actToken(id, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function currentRow(store: Store, id: string): Promise<LedgerRow | undefined> {
  try {
    const { history } = await store.why({ id });
    return history.at(-1);
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

function outcomeFor(row: LedgerRow): string | undefined {
  switch (row.state) {
    case "held":
      return `Held until ${formatTime(row.releaseAt)}`;
    case "dropped":
      return "Dropped";
    case "acked":
      return "Acked";
    case "resolved":
      return "Resolved";
    default:
      return undefined;
  }
}

function actionButton(id: string, token: string, op: string, label: string): string {
  return (
    `<form method="POST" action="/act/${id}">` +
    `<input type="hidden" name="t" value="${escapeHtml(token)}">` +
    `<input type="hidden" name="op" value="${op}">` +
    `<button type="submit">${label}</button></form>`
  );
}

function renderPage(row: LedgerRow, id: string, token: string): string {
  const outcome = outcomeFor(row);
  const actions = ACTIONABLE_STATES.has(row.state)
    ? [
        actionButton(id, token, "hold-1h", "Hold 1h"),
        actionButton(id, token, "hold-boundary", "After meeting"),
        actionButton(id, token, "drop", "Drop"),
      ].join("\n")
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(row.title)}</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 24px 16px; background: #fafafa; color: #111; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  dl { margin: 0 0 20px; }
  dt { font-weight: 600; color: #666; font-size: 13px; }
  dd { margin: 0 0 12px; font-size: 16px; }
  form { display: inline-block; margin: 0 8px 8px 0; }
  button { font-size: 16px; padding: 12px 20px; border-radius: 8px; border: none; background: #111; color: #fff; }
  .outcome { font-size: 16px; font-weight: 600; }
</style>
</head>
<body>
<h1>${escapeHtml(row.title)}</h1>
<dl>
  <dt>Kind</dt><dd>${escapeHtml(row.kind)}</dd>
  <dt>Tier</dt><dd>${escapeHtml(row.tier)}</dd>
  <dt>State</dt><dd>${escapeHtml(row.state)}</dd>
  <dt>Release</dt><dd>${escapeHtml(row.releaseAt)}</dd>
</dl>
${actions}
${outcome !== undefined ? `<p class="outcome">${escapeHtml(outcome)}</p>` : ""}
</body>
</html>`;
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function applyOp(store: Store, row: LedgerRow, op: string): Promise<LedgerRow> {
  switch (op) {
    case "hold-1h":
      return store.hold({ id: row.id, actor: "phone", for: "1h" });
    case "hold-boundary":
      return store.hold({ id: row.id, actor: "phone", until: "boundary" });
    case "drop":
      return store.drop({ id: row.id, actor: "phone" });
    default:
      return row;
  }
}

function defaultPort(): number {
  return process.env.CHIEF_ACT_PORT !== undefined
    ? Number(process.env.CHIEF_ACT_PORT)
    : DEFAULT_PORT;
}

export interface ActServerOptions {
  store: Store;
  port?: number | undefined;
  secret: string;
}

export function startActServer(options: ActServerOptions): ReturnType<typeof Bun.serve> {
  const { store, secret } = options;
  const port = options.port ?? defaultPort();

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") return Response.json({ status: "ok" });

      const match = /^\/act\/(.+)$/.exec(url.pathname);
      if (match?.[1] === undefined) return new Response("not found", { status: 404 });
      const id = decodeURIComponent(match[1]);

      if (req.method === "GET") {
        const token = url.searchParams.get("t") ?? "";
        if (!verify(secret, id, token)) return new Response("forbidden", { status: 403 });
        const row = await currentRow(store, id);
        if (!row) return new Response("not found", { status: 404 });
        return html(renderPage(row, id, token));
      }

      if (req.method === "POST") {
        const form = await req.formData();
        const token = formString(form, "t");
        if (!verify(secret, id, token)) return new Response("forbidden", { status: 403 });
        const before = await currentRow(store, id);
        if (!before) return new Response("not found", { status: 404 });
        const after = await applyOp(store, before, formString(form, "op"));
        return html(renderPage(after, id, token));
      }

      return new Response("method not allowed", { status: 405 });
    },
  });
}
