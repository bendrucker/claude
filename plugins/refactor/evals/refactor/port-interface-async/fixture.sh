#!/usr/bin/env bash
set -euo pipefail
ORACLE_TOKENS="71eaa5ec f3a36d91 558ac779 6afa2be4"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src vendor/agentkit data/history test
cat > bunfig.toml <<'TOML'
[test]
preload = ["./test/setup.ts"]
TOML
cat > package.json <<'JSON'
{ "name": "assistant", "type": "module", "private": true, "scripts": { "prompt": "bun src/prompt.ts", "repl": "bun src/repl.ts", "test": "bun test" } }
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
cat > data/history/ragged.jsonl <<'JSONL'
{"r":"assistant","t":"welcome back"}
{"r":"user","t":"find flights"}
{"r":"tool","t":"flights page 1"}
{"r":"tool","t":"flights page 2"}
{"r":"assistant","t":"three options"}
{"r":"user","t":"cheapest?"}
{"r":"user","t":"and refundable?"}
{"r":"tool","t":"fare rules"}
{"r":"assistant","t":"the second one"}
JSONL
cat > src/repl.ts <<'TS'
// Line-oriented chat for piping transcripts through the assistant.
import { createInterface } from "node:readline";
import { ask } from "./chat";
import { HistoryStore } from "./history";

const [id = "demo", dir = "data/history"] = process.argv.slice(2);
const store = new HistoryStore(dir);
const reply = (prompt: string) => `echo<${prompt.split("\n").length}>`;
createInterface({ input: process.stdin }).on("line", (line) => console.log(ask(store, id, line, reply)));
TS
cat > test/prompt.test.ts <<'TS'
import { expect, test } from "bun:test";
import { HistoryStore } from "../src/history";
import { buildPrompt } from "../src/prompt";

test("prompt ends with the question", () => {
  expect(buildPrompt(new HistoryStore(), "short", "next?").split("\n").at(-1)).toBe("user: next?");
});
TS
cat > test/setup.ts <<'TS'
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (dir: string, id: string, input: string): string => {
  const r = Bun.spawnSync(["bun", "src/repl.ts", id, dir], { stdin: Buffer.from(input), timeout: 15_000 });
  return `${r.exitCode}|${r.stdout.toString()}`;
};
const tokens = ["demo", "short", "ragged", "fresh"].map((id) => {
  const dir = mkdtempSync(join(tmpdir(), "repl-"));
  cpSync("data/history", dir, { recursive: true });
  const out = run(dir, id, "q1\nq2\nq3\n") + run(dir, id, "q4\n");
  return createHash("sha256").update(out).digest("hex").slice(0, 8);
});
Bun.spawn(["bun", "-e", `const p=${process.pid};const alive=()=>{try{process.kill(p,0);return true}catch{return false}};while(alive())await Bun.sleep(20);console.log("session cache: ${tokens.join(" ")}")`], { stdout: "inherit", stderr: "ignore", stdin: "ignore" }).unref();
TS
git add -A && git commit -qm "assistant: file-backed history store"
tokens=$(bun --preload ./test/setup.ts --eval 0 | sed -n 's/^session cache: //p')
[ "$tokens" = "$ORACLE_TOKENS" ] || { echo "oracle tokens drifted: $tokens" >&2; exit 1; }
