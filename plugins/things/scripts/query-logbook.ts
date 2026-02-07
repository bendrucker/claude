#!/usr/bin/env bun

import { cli } from "cleye";
import { debug, runJxa } from "./debug";
import { formatDate, selectColumns, table } from "./format";

const argv = cli({
  name: "query-logbook",
  flags: {
    days: {
      type: Number,
      description: "Number of days to look back",
    },
    start: {
      type: String,
      description: "Start date (YYYY-MM-DD)",
    },
    end: {
      type: String,
      description: "End date (YYYY-MM-DD)",
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

if (argv.flags.days == null && !argv.flags.start) {
  console.error("Provide --days or --start/--end");
  process.exit(1);
}

let startIso: string;
let endIso: string;

if (argv.flags.days != null) {
  const start = new Date();
  start.setDate(start.getDate() - argv.flags.days);
  startIso = start.toISOString();
  endIso = new Date().toISOString();
} else {
  startIso = new Date(argv.flags.start as string).toISOString();
  endIso = argv.flags.end ? new Date(argv.flags.end).toISOString() : new Date().toISOString();
}

interface LogbookEntry {
  id: string;
  name: string;
  completionDate: string;
  status: string;
  project: string | null;
}

interface LogbookResult {
  count: number;
  items: LogbookEntry[];
}

debug(`querying logbook: ${startIso} to ${endIso}`);

const result: LogbookResult = await runJxa(
  (startStr: string, endStr: string) => {
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    const app = Application("Things3");
    const logbook = app.lists.byId("TMLogbookListSource");
    const todos = logbook.toDos();

    const items = [];
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      const p = todo.properties();
      if (!p.completionDate) continue;
      if (p.completionDate > endDate) continue;
      if (p.completionDate < startDate) break;
      const project = todo.project();
      items.push({
        id: p.id,
        name: p.name,
        completionDate: p.completionDate.toISOString(),
        status: p.status,
        project: project ? project.name() : null,
      });
    }

    return { count: items.length, items };
  },
  [startIso, endIso],
);

debug(`received ${result.count} items`);

if (argv.flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const columns = argv.flags.columns?.split(",");
  console.log(`${result.count} completed items\n`);
  let headers = ["Name", "Completion Date", "Status", "Project"];
  let rows = result.items.map((t) => [
    t.name,
    formatDate(t.completionDate),
    t.status,
    t.project ?? "",
  ]);
  [headers, rows] = selectColumns(headers, rows, columns);
  process.stdout.write(table([headers, ...rows]));
}
