---
fail: [short-close, signatures]
---
Looked at the current CLI — it's a flat `Record<string, Command>` in `src/commands/index.ts`, with `Command = { description, run(args) }`, built statically and consumed by `cli.ts` and `help.ts`. Here's the design I'd propose to extend that with third-party discovery.

## 1. Discovery: read declared deps, don't walk `node_modules`

Don't recursively scan `node_modules` on disk — with pnpm's non-flat layout, nested workspaces, etc. that's slow and unreliable. Instead:

1. Read the nearest `package.json` (from `cwd` upward) and take its `dependencies`/`devDependencies` keys.
2. Filter to a naming convention: `mycli-plugin-*` or scoped `@*/mycli-plugin-*`.
3. Resolve each with Node's own resolution (`require.resolve(name, { paths: [cwd] })` / dynamic `import()`), so pnpm/yarn/npm layouts all just work — you're not reinventing module resolution.

This mirrors how ESLint/Prettier do it, and keeps discovery bounded by what the project actually declared as a dependency, not anything incidentally present on disk.

## 2. Plugin contract

Package's main export matches the existing `Command` shape, just namespaced:

```ts
// what a plugin package exports
export interface Plugin {
  commands: Record<string, Command>;
}
```

Ship a tiny `mycli-plugin-sdk` (types-only, no runtime code) so authors get typing without a runtime dependency on core — avoids version-coupling and duplicate-instance issues if core ever carries internal state.

## 3. Conflict resolution

- Core commands always win over plugin commands (can't be shadowed).
- Plugin vs. plugin name collision: warn at startup naming both packages, skip the second, don't crash.

## 4. Fault isolation

Each plugin load and `require`/`import` wrapped in try/catch. A broken plugin logs a warning tagged with its package name and is skipped — it never takes down the whole CLI at startup.

## 5. Security: discovery ≠ activation

This is the part I'd flag most: auto-running any correctly-named `node_modules` package at every invocation means a transitive or typosquatted dependency could silently hook into every command. I'd separate **discovery** (find candidates) from **activation** (actually load them), gated by an explicit allowlist in a config file (e.g. `.myclirc` `plugins: ["mycli-plugin-foo"]`), similar to how VS Code extensions require explicit enable. First run could prompt "found plugin X, enable it?" and persist the answer.

## 6. File-level plan

- `src/plugins/discover.ts` — dependency scan + resolution + allowlist check
- `src/plugins/types.ts` — `Plugin` interface
- `src/commands/index.ts` — `commands` build becomes async, merges core + discovered plugin commands
- `cli.ts` — awaits command-map construction before dispatch

Main tradeoff: the allowlist adds friction (an extra config step before a plugin works) in exchange for not silently trusting every matching package name — I think that's the right default for something that runs on every invocation, but it's a call worth confirming with you.

Want me to implement this?
