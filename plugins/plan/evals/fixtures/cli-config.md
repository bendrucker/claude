Our CLI takes a `--region` flag on almost every command. People are tired of typing it. I want a `config` subcommand so they can set a default once and have the other commands pick it up. Running `tool config set region us-west` should persist across runs, and after that `tool deploy` should behave as if `--region us-west` was passed.

It is a Node + TypeScript CLI. Commands are defined with `cleye` for type-safe argv parsing. Here is the layout.

```
src/
  cli.ts               # entrypoint, declares the command tree (below)
  commands/
    deploy.ts          # deploy command, reads --region (below)
    status.ts          # status command, also reads --region
  lib/
    region.ts          # resolveRegion(flags) -> string, used by commands
    paths.ts           # homeDir(), exposes the user's home directory
```

`src/cli.ts`:

```ts
import { cli, command } from "cleye";
import { deploy } from "./commands/deploy";
import { status } from "./commands/status";

cli({
  name: "tool",
  commands: [deploy, status],
});
```

`src/commands/deploy.ts`:

```ts
import { command } from "cleye";
import { resolveRegion } from "../lib/region";

export const deploy = command(
  {
    name: "deploy",
    flags: {
      region: { type: String, description: "Target region" },
    },
  },
  (argv) => {
    const region = resolveRegion(argv.flags);
    // ... ships the build to `region`
  },
);
```

`src/lib/region.ts`:

```ts
export function resolveRegion(flags: { region?: string }): string {
  const region = flags.region ?? process.env.TOOL_REGION;
  if (!region) {
    throw new Error("no region: pass --region or set TOOL_REGION");
  }
  return region;
}
```

So today a command resolves its region from the explicit `--region` flag, then falls back to the `TOOL_REGION` environment variable. No stored config exists yet. Nothing reads or writes a file. I want `config get region` and `config set region <value>` to exist, and the stored value should slot in as a default that the existing commands honor. For now `region` is the only setting that matters. I would not be shocked if we add a couple more later.

Keep it to the `config` command and making the stored value take effect. I do not want to redo how every command declares its flags, and I am not looking for anything pluggable. Plan the implementation.
