#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src vendor/agentkit data/history
cat > package.json <<'JSON'
{ "name": "assistant", "type": "module", "private": true, "scripts": { "prompt": "bun src/prompt.ts" } }
JSON
cat > vendor/agentkit/store.ts <<'TS'
export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

export class SessionNotFound extends Error {}

export interface MessageStore {
  append(sessionId: string, messages: Message[]): Promise<void>;
  /** The most recent `limit` messages, oldest first. Throws SessionNotFound for an unknown session. */
  load(sessionId: string, opts?: { limit?: number }): Promise<Message[]>;
}
TS
cat > src/history.ts <<'TS'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

export type Role = "user" | "assistant" | "tool";
type Entry = { r: Role; t: string };

export class HistoryStore {
  constructor(private dir = "data/history") {
    mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    return `${this.dir}/${id}.jsonl`;
  }

  add(id: string, role: Role, text: string) {
    appendFileSync(this.file(id), JSON.stringify({ r: role, t: text } satisfies Entry) + "\n");
  }

  /** The last `turns` turns. A turn starts at a user message and runs until the next one. */
  recent(id: string, turns: number): { role: Role; text: string }[] {
    if (!existsSync(this.file(id))) return [];
    const all: Entry[] = readFileSync(this.file(id), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const starts = all.flatMap((e, i) => (e.r === "user" ? [i] : []));
    const from = starts.length > turns ? starts[starts.length - turns] : 0;
    return all.slice(from).map((e) => ({ role: e.r, text: e.t }));
  }
}
TS
cat > src/prompt.ts <<'TS'
import { HistoryStore } from "./history";

export function buildPrompt(store: HistoryStore, sessionId: string, question: string): string {
  const context = store.recent(sessionId, 3).map((m) => `${m.role}: ${m.text}`);
  return [...context, `user: ${question}`].join("\n");
}

if (import.meta.main) {
  console.log(buildPrompt(new HistoryStore(), process.argv[2] ?? "demo", process.argv[3] ?? "what next?"));
}
TS
cat > src/chat.ts <<'TS'
import { HistoryStore } from "./history";
import { buildPrompt } from "./prompt";

export function ask(store: HistoryStore, sessionId: string, question: string, reply: (prompt: string) => string): string {
  const answer = reply(buildPrompt(store, sessionId, question));
  store.add(sessionId, "user", question);
  store.add(sessionId, "assistant", answer);
  return answer;
}
TS
{
  for i in 1 2 3 4 5; do
    printf '{"r":"user","t":"question %s"}\n' "$i"
    printf '{"r":"tool","t":"search result %s"}\n' "$i"
    printf '{"r":"assistant","t":"answer %s"}\n' "$i"
  done
} > data/history/demo.jsonl
printf '{"r":"user","t":"hi"}\n{"r":"assistant","t":"hello"}\n' > data/history/short.jsonl
git add -A && git commit -qm "assistant: file-backed history store"
