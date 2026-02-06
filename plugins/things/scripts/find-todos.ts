#!/usr/bin/env bun

import { cli } from "cleye";
import { runJxa } from "run-jxa";
import { table } from "./format";

const argv = cli({
  name: "find-todos",
  flags: {
    tag: {
      type: String,
      description: "Find todos by tag name",
    },
    project: {
      type: String,
      description: "Find todos by project name",
    },
    json: {
      type: Boolean,
      description: "Output as JSON",
    },
  },
});

const mode = argv.flags.tag ? "tag" : argv.flags.project ? "project" : null;
const value = argv.flags.tag ?? argv.flags.project;

if (!mode || !value) {
  console.error("Provide --tag or --project with a name");
  process.exit(1);
}

interface Todo {
  id: string;
  name: string;
  status: string;
  project?: string | null;
  notes?: string;
}

const items: Todo[] = await runJxa(
  (m: string, v: string) => {
    const app = Application("Things3");

    if (m === "tag") {
      const tag = app.tags.whose({ name: v })[0];
      if (!tag) return { error: `Tag not found: ${v}` };
      const todos = tag.toDos();
      const result = [];
      for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        const project = t.project();
        result.push({
          id: t.id(),
          name: t.name(),
          status: t.status().toString(),
          project: project ? project.name() : null,
        });
      }
      return result;
    }

    const project = app.projects.whose({ name: v })[0];
    if (!project) return { error: `Project not found: ${v}` };
    const todos = project.toDos();
    const result = [];
    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      result.push({
        id: t.id(),
        name: t.name(),
        status: t.status().toString(),
        notes: t.notes() || "",
      });
    }
    return result;
  },
  [mode, value],
);

if ("error" in items) {
  console.error((items as unknown as { error: string }).error);
  process.exit(1);
}

if (argv.flags.json) {
  console.log(JSON.stringify(items, null, 2));
} else {
  let headers: string[];
  let rows: string[][];

  if (mode === "tag") {
    headers = ["Name", "Status", "Project"];
    rows = items.map((t) => [t.name, t.status, t.project ?? ""]);
  } else {
    headers = ["Name", "Status"];
    rows = items.map((t) => [t.name, t.status]);
  }

  process.stdout.write(table([headers, ...rows]));
}
