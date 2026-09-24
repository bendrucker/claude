#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/commands src/sessions
cat > src/commands/send.ts <<'TS'
import { post, stream } from "../transport";

export async function send(prompt: string) {
  const { id } = await post("/sessions", { prompt });
  for await (const chunk of stream(`/sessions/${id}/events`)) process.stdout.write(chunk);
}
TS
cat > src/sessions/state.ts <<'TS'
export const sessions = new Map<string, { prompt: string; done: boolean }>();
TS
cat > src/transport.ts <<'TS'
const BASE = process.env.API_URL ?? "http://localhost:4000";
let token: string | undefined;

export function setToken(value: string) {
  token = value;
}

function headers(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" };
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export async function* stream(path: string): AsyncGenerator<string> {
  const res = await fetch(BASE + path, { headers: { ...headers(), accept: "text/event-stream" } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const e of events) yield e.replace(/^data: /, "");
  }
}
TS
