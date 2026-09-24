#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/commands
cat > src/cli.ts <<'TS'
import { commands } from "./commands";

const [name, ...args] = process.argv.slice(2);
const command = commands[name ?? "help"];
if (!command) {
  console.error(`unknown command: ${name}`);
  process.exit(1);
}
await command.run(args);
TS
cat > src/commands/index.ts <<'TS'
import { build } from "./build";
import { help } from "./help";

export interface Command {
  description: string;
  run(args: string[]): Promise<void>;
}

export const commands: Record<string, Command> = { build, help };
TS
cat > src/commands/build.ts <<'TS'
export const build = {
  description: "Build the project",
  async run(args: string[]) {
    console.log("building", args);
  },
};
TS
cat > src/commands/help.ts <<'TS'
import { commands } from "./index";

export const help = {
  description: "List commands",
  async run() {
    for (const [name, c] of Object.entries(commands)) console.log(name, c.description);
  },
};
TS
