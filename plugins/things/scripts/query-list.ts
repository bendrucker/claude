#!/usr/bin/env bun

import { cli } from "cleye";
import { debug, runJxa } from "./debug";
import { formatDate, selectColumns, table } from "./format";

const argv = cli({
  name: "query-list",
  parameters: ["<list-id>"],
  flags: {
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

interface Todo {
  id: string;
  name: string;
  notes: string;
  status: string;
  dueDate: string | null;
  activationDate: string | null;
  tags: string;
  project: string | null;
  area: string | null;
  creationDate: string | null;
}

debug(`querying list: ${argv._.listId}`);

const items: Todo[] = await runJxa(
  (listId: string) => {
    const app = Application("Things3");
    const list = app.lists.byId(listId);
    const todos = list.toDos();
    const result = [];

    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      const props = t.properties();
      const project = t.project();
      const area = t.area();
      result.push({
        id: props.id,
        name: props.name,
        notes: props.notes || "",
        status: props.status,
        dueDate: props.dueDate ? props.dueDate.toISOString() : null,
        activationDate: props.activationDate ? props.activationDate.toISOString() : null,
        tags: props.tagNames || "",
        project: project ? project.name() : null,
        area: area ? area.name() : null,
        creationDate: props.creationDate ? props.creationDate.toISOString() : null,
      });
    }

    return result;
  },
  [argv._.listId],
);

debug(`received ${items.length} items`);

if (argv.flags.json) {
  console.log(JSON.stringify(items, null, 2));
} else {
  const columns = argv.flags.columns?.split(",");
  let headers = ["Name", "Status", "Due Date", "Project", "Tags"];
  let rows = items.map((t) => [t.name, t.status, formatDate(t.dueDate), t.project ?? "", t.tags]);
  [headers, rows] = selectColumns(headers, rows, columns);
  process.stdout.write(table([headers, ...rows]));
}
