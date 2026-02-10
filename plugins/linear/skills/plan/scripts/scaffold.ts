#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";

function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function scaffold(name: string, dir: string): Promise<string> {
  const root = join(dir, `linear-plan-${name}`);

  await mkdir(join(root, "issues", "milestones"), { recursive: true });
  await mkdir(join(root, ".claude"), { recursive: true });

  await writeFile(join(root, `${name}.md`), `# ${toTitleCase(name)}\n`);

  await writeFile(
    join(root, ".claude", "settings.local.json"),
    `${JSON.stringify(
      {
        permissions: {
          allow: ["mcp__linear"],
        },
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

async function main() {
  const argv = cli({
    name: "scaffold",
    parameters: ["<name>"],
    flags: {
      dir: {
        type: String,
        description: "Base directory for the plan",
        default: "/tmp/claude",
      },
    },
    help: {
      description: "Scaffold a new Linear plan directory",
    },
  });

  const path = await scaffold(argv._.name, argv.flags.dir);
  console.log(path);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
