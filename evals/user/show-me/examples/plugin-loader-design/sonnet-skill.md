Looked at the existing structure — it's a minimal `Command` interface (`{ description, run(args) }`) statically registered in `src/commands/index.ts` and dispatched from `src/cli.ts`. Here's the design I'd propose for letting third-party packages register commands via node_modules.

## Discovery: convention name + explicit manifest, not a full node_modules walk

Don't crawl the entire `node_modules` tree — walk the *declared* dependencies from the nearest `package.json` (cwd upward) and filter by a naming convention, same pattern as `eslint-plugin-*`/`babel-plugin-*`:

- Candidate packages: keys in `dependencies`/`devDependencies` matching `<cli-name>-plugin-*` or `@*/​<cli-name>-plugin-*`.
- For each candidate, resolve it with Node's resolver and dynamic `import()` it.

This keeps discovery to O(declared deps) instead of O(everything nested in node_modules), and it means a package only gets loaded if the project owner actually installed it — no surprise execution from transitive deps.

## Plugin contract

Ship the `Command` type (already in `commands/index.ts`) as a tiny published type-only entry point (e.g. `my-cli/plugin`), so third parties get typing without a runtime dependency on the CLI:

```ts
// my-cli/plugin (types only)
export interface Command {
  description: string;
  run(args: string[]): Promise<void>;
}
export interface CliPlugin {
  name: string;                    // namespace, e.g. "deploy"
  commands: Record<string, Command>;
}
```

A third-party package's entry point default-exports a `CliPlugin`:

```ts
// my-cli-plugin-deploy/src/index.ts
const plugin: CliPlugin = {
  name: "deploy",
  commands: { deploy: { description: "Deploy the project", run: async (args) => { ... } } },
};
export default plugin;
```

## Namespacing

Plugin commands get exposed as `<pluginName>:<commandName>` (e.g. `deploy:run`), never as bare names. Built-ins keep bare names. This avoids silent shadowing — two plugins can't stomp on each other or on a built-in, and there's no ambiguity about where a command came from. Trade-off: slightly more typing for plugin users, but collisions in an open ecosystem are inevitable and silent overrides are worse.

## Loading & failure isolation

Each plugin is imported and validated independently, in parallel, wrapped so one broken plugin can't take down the CLI:

```ts
async function discoverPlugins(): Promise<Record<string, Command>> {
  const candidates = getDeclaredDeps().filter(isPluginName);
  const results = await Promise.allSettled(candidates.map(loadPlugin));
  const commands: Record<string, Command> = {};
  for (const [pkg, result] of zip(candidates, results)) {
    if (result.status === "rejected" || !isValidPlugin(result.value)) {
      console.error(`warning: skipping invalid plugin "${pkg}"`);
      continue;
    }
    const plugin = result.value;
    for (const [cmd, impl] of Object.entries(plugin.commands)) {
      commands[`${plugin.name}:${cmd}`] = impl;
    }
  }
  return commands;
}
```

## Integration into existing files

```
src/
  cli.ts                 # await loadCommands() instead of static import
  commands/index.ts       # built-ins only, unchanged
  plugins/discover.ts     # new: discoverPlugins()
  plugins/types.ts        # new: CliPlugin (published as my-cli/plugin)
```

`cli.ts` changes minimally since it already top-level-awaits:

```ts
const commands = { ...builtinCommands, ...(await discoverPlugins()) };
```

## Escape hatch

Add a `--no-plugins` flag / `MY_CLI_NO_PLUGINS` env var that skips discovery entirely — useful for CI reliability, debugging "which command came from where," and as defense-in-depth given this runs arbitrary installed code on every invocation.

---

I'd skip caching the discovered plugin list for now — the candidate-filtering step is already cheap and it's unnecessary complexity until you see real startup-time pain.

Want me to implement this against the current repo?
