#!/usr/bin/env bun

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { isScope, SCOPES } from "../assets";
import { collect, filter, type Filters } from "./collect";
import { isKind, KINDS, records, render, section } from "./report";

function number(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

export const program = new Command("inventory")
  .description(`List this repository's Claude Code assets. Kinds: ${KINDS.join(", ")}.`)
  .argument("[kind]")
  .option("--plugin <name>", "Restrict to one plugin")
  .option("--scope <scope>", `Restrict to assets registered as ${SCOPES.join(", ")}`)
  .option(
    "--truncate <n>",
    "Character budget for description and command columns (0 disables)",
    number,
    100,
  )
  .option("--json", "Emit the raw records instead of a table")
  .action(async (requested, flags) => {
    const kind = requested ?? "summary";
    if (!isKind(kind)) {
      console.error(`Unknown kind "${kind}". Expected one of: ${KINDS.join(", ")}`);
      process.exit(1);
    }

    const { plugin, scope, truncate, json } = flags;
    if (scope !== undefined && !isScope(scope)) {
      console.error(`Unknown scope "${scope}". Expected one of: ${SCOPES.join(", ")}`);
      process.exit(1);
    }

    // A non-finite value such as Infinity fails every comparison in truncate()
    // and blanks the column it budgets.
    if (!Number.isFinite(truncate)) {
      console.error("--truncate takes a number of characters, or 0 to disable.");
      process.exit(1);
    }

    const criteria: Filters = {};
    if (plugin != null && plugin !== "") criteria.plugin = plugin;
    if (scope != null) criteria.scope = scope;
    const inventory = filter(await collect(), criteria);

    if (json === true) {
      console.log(JSON.stringify(records(inventory, kind), null, 2));
    } else {
      console.log(render(section(inventory, kind, truncate)));
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
