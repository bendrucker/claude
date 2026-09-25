#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "tasks", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/model.ts <<'TS'
export interface Task {
  title: string;
  done: boolean;
}
TS
cat > src/store.ts <<'TS'
import type { Task } from "./model";

export class Store {
  private tasks: Task[] = [];

  add(title: string): Task {
    const task = { title, done: false };
    this.tasks.push(task);
    return task;
  }

  list(): Task[] {
    return [...this.tasks];
  }
}
TS
cat > src/format.ts <<'TS'
import type { Task } from "./model";

export function formatTask(task: Task): string {
  return `[${task.done ? "x" : " "}] ${task.title}`;
}
TS
git add -A && git commit -qm "tasks: store and format"
git push -qu origin main
git switch -qc task-priority
cat > src/model.ts <<'TS'
export type Priority = "low" | "normal" | "high";

export interface Task {
  title: string;
  done: boolean;
  priority: Priority;
}

export const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
TS
cat > src/store.ts <<'TS'
import { type Priority, type Task, priorityRank } from "./model";

export class Store {
  private tasks: Task[] = [];

  add(title: string, priority: Priority = "normal"): Task {
    const task = { title, done: false, priority };
    this.tasks.push(task);
    return task;
  }

  list(): Task[] {
    return [...this.tasks].sort(
      (a, b) => Number(a.done) - Number(b.done) || priorityRank[a.priority] - priorityRank[b.priority],
    );
  }

  reprioritize(title: string, priority: Priority): boolean {
    const task = this.tasks.find((t) => t.title === title);
    if (!task) return false;
    task.priority = priority;
    return true;
  }
}
TS
cat > src/format.ts <<'TS'
import type { Task } from "./model";

const marks = { high: "!", normal: " ", low: "·" };

export function formatTask(task: Task): string {
  return `[${task.done ? "x" : " "}]${marks[task.priority]} ${task.title}`;
}
TS
cat > test/store.test.ts <<'TS'
import { expect, test } from "bun:test";
import { Store } from "../src/store";

test("lists open tasks by priority", () => {
  const store = new Store();
  store.add("later", "low");
  store.add("now", "high");
  store.add("soon");
  expect(store.list().map((t) => t.title)).toEqual(["now", "soon", "later"]);
});

test("reprioritizes by title", () => {
  const store = new Store();
  store.add("a");
  expect(store.reprioritize("a", "high")).toBe(true);
  expect(store.reprioritize("missing", "high")).toBe(false);
});
TS
git add -A && git commit -qm "tasks: priorities"
