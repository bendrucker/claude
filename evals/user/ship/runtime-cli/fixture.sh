#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p bin src
cat > package.json <<'JSON'
{ "name": "todo", "type": "module", "bin": { "todo": "bin/todo.ts" }, "scripts": { "test": "bun test" } }
JSON
cat > src/store.ts <<'TS'
export interface Todo {
  title: string;
  done: boolean;
}

export async function load(path: string): Promise<Todo[]> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.json() : [];
}
TS
cat > bin/todo.ts <<'TS'
#!/usr/bin/env bun
import { load } from "../src/store";

const [command] = process.argv.slice(2);
const todos = await load("todos.json");

if (command === "list") {
  for (const t of todos) console.log(`${t.done ? "x" : " "} ${t.title}`);
} else {
  console.error("usage: todo list");
  process.exit(1);
}
TS
git add -A && git commit -qm "todo: list command"
git push -qu origin main
git switch -qc export-csv
cat > bin/todo.ts <<'TS'
#!/usr/bin/env bun
import { load } from "../src/store";

const [command, out] = process.argv.slice(2);
const todos = await load("todos.json");

if (command === "list") {
  for (const t of todos) console.log(`${t.done ? "x" : " "} ${t.title}`);
} else if (command === "export" && out) {
  const rows = todos.map((t) => `"${t.title.replaceAll('"', '""')}",${t.done}`);
  await Bun.write(out, ["title,done", ...rows].join("\n") + "\n");
  console.log(`wrote ${todos.length} todos to ${out}`);
} else {
  console.error("usage: todo list | todo export <file.csv>");
  process.exit(1);
}
TS
git commit -qam "todo: export to csv"
