#!/usr/bin/env bun

import { cli } from "cleye";
import { debug, runJxa } from "./debug";
import { selectColumns, table } from "./format";

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
    columns: {
      type: String,
      description: "Columns to include (comma-separated)",
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

type Result = { error: string } | Todo[];

debug(`finding todos by ${mode}: ${value}`);

const result = (await runJxa(
  (m: string, v: string) => {
    const app = Application("Things3");

    if (m === "tag") {
      const tag = app.tags.whose({ name: v })[0];
      if (!tag) return { error: `Tag not found: ${v}` };
      const todos = tag.toDos();
      const items = [];
      for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        const project = t.project();
        items.push({
          id: t.id(),
          name: t.name(),
          status: t.status().toString(),
          project: project ? project.name() : null,
        });
      }
      return items;
    }

    const project = app.projects.whose({ name: v })[0];
    if (!project) return { error: `Project not found: ${v}` };
    const todos = project.toDos();
    const items = [];
    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      items.push({
        id: t.id(),
        name: t.name(),
        status: t.status().toString(),
        notes: t.notes() || "",
      });
    }
    return items;
  },
  [mode, value],
)) as Result;

if ("error" in result) {
  console.error(result.error);
  process.exit(1);
}

const items = result;
debug(`received ${items.length} items`);

if (argv.flags.json) {
  console.log(JSON.stringify(items, null, 2));
} else {
  const columns = argv.flags.columns?.split(",");
  let headers: string[];
  let rows: string[][];

  if (mode === "tag") {
    headers = ["Name", "Status", "Project"];
    rows = items.map((t) => [t.name, t.status, t.project ?? ""]);
  } else {
    headers = ["Name", "Status"];
    rows = items.map((t) => [t.name, t.status]);
  }

  [headers, rows] = selectColumns(headers, rows, columns);
  process.stdout.write(table([headers, ...rows]));
}
