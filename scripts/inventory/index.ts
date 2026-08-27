#!/usr/bin/env bun

import { cli } from "cleye";
import { isScope, SCOPES } from "../assets";
import { collect, filter, type Filters } from "./collect";
import { isKind, KINDS, records, render, section } from "./report";

const argv = cli({
  name: "inventory",
  parameters: ["[kind]"],
  help: {
    description: `List this repository's Claude Code assets. Kinds: ${KINDS.join(", ")}.`,
  },
  flags: {
    plugin: {
      type: String,
      description: "Restrict to one plugin",
    },
    scope: {
      type: String,
      description: `Restrict to assets registered as ${SCOPES.join(", ")}`,
    },
    truncate: {
      type: Number,
      default: 100,
      description: "Character budget for description and command columns (0 disables)",
    },
    json: {
      type: Boolean,
      description: "Emit the raw records instead of a table",
    },
  },
});

const kind = argv._.kind ?? "summary";
if (!isKind(kind)) {
  console.error(`Unknown kind "${kind}". Expected one of: ${KINDS.join(", ")}`);
  process.exit(1);
}

const { plugin, scope, truncate, json } = argv.flags;
if (scope !== undefined && !isScope(scope)) {
  console.error(`Unknown scope "${scope}". Expected one of: ${SCOPES.join(", ")}`);
  process.exit(1);
}

// cleye coerces with Number(), so a missing or non-numeric value arrives as NaN,
// which every comparison in truncate() fails and blanks the column it budgets.
if (!Number.isFinite(truncate)) {
  console.error("--truncate takes a number of characters, or 0 to disable.");
  process.exit(1);
}

const criteria: Filters = {};
if (plugin) criteria.plugin = plugin;
if (scope) criteria.scope = scope;
const inventory = filter(await collect(), criteria);

if (json) {
  console.log(JSON.stringify(records(inventory, kind), null, 2));
} else {
  console.log(render(section(inventory, kind, truncate)));
}
