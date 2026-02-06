#!/usr/bin/env bun

import { cli } from "cleye";
import { runJxa } from "run-jxa";
import { table } from "./format";

const TYPES = ["projects", "areas", "tags"] as const;
type MetadataType = (typeof TYPES)[number];

const argv = cli({
  name: "query-metadata",
  parameters: ["<type>"],
  flags: {
    json: {
      type: Boolean,
      description: "Output as JSON",
    },
  },
});

const type = argv._.type as string;
if (!TYPES.includes(type as MetadataType)) {
  console.error(`Invalid type: ${type}. Use: projects, areas, or tags`);
  process.exit(1);
}

const items: Record<string, unknown>[] = await runJxa(
  (t: string) => {
    const app = Application("Things3");
    const result: Record<string, unknown>[] = [];

    if (t === "projects") {
      const projects = app.projects();
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        const area = p.area();
        result.push({
          id: p.id(),
          name: p.name(),
          area: area ? area.name() : null,
          status: p.status().toString(),
          todoCount: p.toDos().length,
        });
      }
    } else if (t === "areas") {
      const areas = app.areas();
      for (let i = 0; i < areas.length; i++) {
        const a = areas[i];
        result.push({
          id: a.id(),
          name: a.name(),
          todoCount: a.toDos().length,
          tags: a.tagNames(),
        });
      }
    } else if (t === "tags") {
      const tags = app.tags();
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const parent = tag.parentTag();
        result.push({
          id: tag.id(),
          name: tag.name(),
          parent: parent ? parent.name() : null,
          todoCount: tag.toDos().length,
        });
      }
    }

    return result;
  },
  [type],
);

if (argv.flags.json) {
  console.log(JSON.stringify(items, null, 2));
} else {
  let headers: string[];
  let rows: string[][];

  if (type === "projects") {
    headers = ["Name", "Area", "Status", "Todos"];
    rows = items.map((p) => [
      String(p.name ?? ""),
      String(p.area ?? ""),
      String(p.status ?? ""),
      String(p.todoCount ?? 0),
    ]);
  } else if (type === "areas") {
    headers = ["Name", "Todos", "Tags"];
    rows = items.map((a) => [String(a.name ?? ""), String(a.todoCount ?? 0), String(a.tags ?? "")]);
  } else {
    headers = ["Name", "Parent", "Todos"];
    rows = items.map((t) => [
      String(t.name ?? ""),
      String(t.parent ?? ""),
      String(t.todoCount ?? 0),
    ]);
  }

  process.stdout.write(table([headers, ...rows]));
}
