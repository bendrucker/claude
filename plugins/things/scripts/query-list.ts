#!/usr/bin/env bun

import { cli } from "cleye";
import { runJxa } from "run-jxa";
import { formatDate, table } from "./format";

const argv = cli({
  name: "query-list",
  parameters: ["<list-id>"],
  flags: {
    json: {
      type: Boolean,
      description: "Output as JSON",
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
}

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
      });
    }

    return result;
  },
  [argv._.listId],
);

if (argv.flags.json) {
  console.log(JSON.stringify(items, null, 2));
} else {
  const rows = items.map((t) => [t.name, t.status, formatDate(t.dueDate), t.project ?? "", t.tags]);
  process.stdout.write(table([["Name", "Status", "Due Date", "Project", "Tags"], ...rows]));
}
