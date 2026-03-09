# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `plugins/`: Plugins providing language support, workflows, and integrations
- `.claude-plugin/marketplace.json`: Marketplace definition listing all available plugins
- `schemas/`: JSON Schema definitions for `plugin.schema.json` and `marketplace.schema.json`
- `user/`: User-level configuration, symlinked to `~/.claude`
- `.claude/`: Project-level configuration for this repository

## User

The [`user/`](user/) directory contains user-level Claude Code configuration that gets symlinked to `~/.claude`. This includes global instructions (`CLAUDE.md`), settings (plugins, permissions, sandbox), and hooks that apply across all projects. Symlinks and other system setup are managed by the [claude topic](https://github.com/bendrucker/dotfiles/tree/main/claude) in dotfiles.

## Plugin Architecture

Each plugin in `plugins/` contains:
- `.claude-plugin/plugin.json`: Plugin metadata
- `skills/`: Skill definitions with `SKILL.md` and reference files
- `hooks/`: Optional hook definitions (`hooks.json`)
- `commands/`: Optional slash commands
- `agents/`: Optional agent definitions

### Naming

The plugin name forms a namespace for its contents (e.g., `gitlab:ci-monitor`). Commands and agents are auto-namespaced by the plugin system — the filename becomes the qualified name (e.g., `ci-monitor.md` in the `gitlab` plugin becomes `gitlab:ci-monitor`). Skills are **not** auto-namespaced — the `name` in YAML frontmatter is used as-is.

Skills where the name differs from the plugin name must include the `plugin-name:` prefix in frontmatter (e.g., `gitlab:ci`, `things:inbox`). Skip the prefix when name equals plugin name (the primary skill) — `bun:bun` adds no information.

Anti-stuttering applies to the part after the colon: `gitlab:gitlab-ci` is wrong, `gitlab:ci` is right.

### Plugin READMEs

Each plugin should have a `README.md` with consistent sections:

- **Title**: `# Plugin Name` with a one-line description
- **Contents**: List what the plugin provides (skills, hooks, agents, commands)
- **Testing**: How to run tests (if the plugin has tests)

Do not include installation instructions or skill activation details—the README is an index, not documentation. Users can read the skill files directly for activation patterns.

### Dependencies

The root `package.json` contains shared tooling (typescript) and dependencies used across multiple plugins (e.g., `url-pattern`). Plugin-specific dependencies belong in their own `package.json`:

- Create `plugins/<name>/package.json` for plugin-specific dependencies
- Add the plugin to the root `workspaces` array
- Run `bun install` to link the workspace

Avoid collecting all dependencies in the root package.json. Each plugin should be self-contained where practical.

### Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing dependencies on first run, eliminating the need to run `bun install` before executing scripts. This simplifies hook execution since hooks run in isolated contexts where `node_modules` may not be readily available.

### Lockfile Conflicts

When resolving `bun.lock` conflicts, regenerate from scratch:

1. Delete the lockfile: `rm bun.lock`
2. Run `bun install` to generate a fresh lockfile

Unlike npm's `package-lock.json`, bun populates integrity hashes for all platforms from the registry, even for packages not downloaded locally. Regenerating from scratch is safe and avoids stale or empty hashes. Do **not** use `git checkout origin/main -- bun.lock && bun install` — this produces empty integrity hashes for platform-specific packages (e.g., `@img/sharp-libvips-linux-x64`), breaking CI on Linux.

### Scripts

When writing scripts (hooks, skill CLIs, etc.) that accept arguments:

- **Argument parsing**: Use [cleye](https://github.com/privatenumber/cleye) for type-safe argument parsing with automatic `--help` generation
- **Table output**: Use the `table` package for formatted terminal table output. Do not use `markdown-table` or similar GFM-oriented packages — script output is displayed in a terminal, not rendered as markdown.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid `dirname()` on a dirname—explicit `".."` is clearer.

## Rules

The `user/rules/` directory contains rule files that auto-inject based on file extension matching via `paths` frontmatter. Rules are symlinked to `~/.claude/rules/` alongside the rest of `user/`.

Use rules for language/file-type guidance that Claude should always have when working with matching files (e.g., Go testing patterns, Python type hints). Use skills for workflow-specific knowledge that requires explicit activation (e.g., Linear issue management, Things task creation).

## Hooks

See the `claude-code:hook` skill for hook documentation. Plugin hooks are defined in `hooks/hooks.json`. This repository includes a Biome PostToolUse hook (`.claude/hooks/biome/`) that runs after file edits to check for lint errors.

## Testing

Plugins use `bun test` for tests. Run all tests with `bun test` or filter by plugin with `bun test plugins/<name>`.

After making changes to plugin scripts, run them directly to verify they work end-to-end, not just via unit tests. For example, after editing `plugins/mac/scripts/jxa.ts`, run `bun plugins/mac/scripts/jxa.ts <app> <script>` with real arguments to confirm the CLI works. Unit tests alone may miss integration issues like argument parsing failures that only surface at runtime.

### CI Structure

Tests run per-plugin in the CI matrix for:
- **Parallelization**: Integration tests can take seconds; running in parallel across plugins is faster
- **Clear feedback**: Failed tests clearly indicate which plugin has the issue

Root-level tests (e.g., `hooks/`) run in a dedicated job since they're not part of any plugin.

### Conventions

- **`bun test` runs all unit tests**: Bun auto-discovers `*.test.ts` files. Integration tests (`*.integration.ts`) are not auto-discovered and can be run by passing paths explicitly (e.g., `bun test plugins/<name>/tests/file.integration.ts`).
- **No `.js` imports in TypeScript**: Import from `./module` not `./module.js`. The bundler/runtime handles resolution.
- **Prefer skills over agents**: Skills are invocable via the Skill tool. Agents require the Task tool. If something should be directly invocable, make it a skill.

### Local Plugin Testing

To test a plugin end-to-end without publishing, use `--plugin-dir` with `--setting-sources local` to isolate from user/project settings:

```bash
claude --plugin-dir ./plugins/<name> --setting-sources local
```

This loads only the specified plugin directory, bypassing marketplace-installed versions. Use this workflow to verify skills, hooks, and scripts work correctly before committing.

### Testing User Settings

To test changes to `user/settings.json` before installing:

```bash
./dev.sh
```

This disables the installed user settings and loads `user/settings.json` from the working copy instead. Any additional arguments are passed to `claude`.

## Verification

Run `scripts/check-marketplace.sh` to verify all plugin directories are listed in `marketplace.json`. This check runs in CI and should pass before merging.

### Skill Linting

Skills are validated with `bun run skill-lint`:

```bash
bun run skill-lint "plugins/<name>/skills/*"
```

This validates SKILL.md frontmatter (name, description) and checks reference depth. `skill-lint` is a workspace package in `packages/skill-lint`, not an npm registry package.

## Workflow

- The `user/` directory is symlinked to `~/.claude/`. New files are immediately available.
- Plugin changes take effect immediately in new Claude sessions.

## Settings

User-level settings live in `user/settings.json` (plugins, permissions, sandbox). Project-level settings live in `.claude/settings.json` (biome hook). See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.

### Permission Paths

Permission patterns starting with `/` are relative to the settings file, not absolute filesystem paths. Use `//` for absolute paths:

- `Edit(tmp/**)` → `<cwd>/tmp/**` (relative to current directory)
- `Edit(//tmp/**)` → `/tmp/**` (absolute)
- `Edit(~/.config/**)` → home directory (tilde expansion works)
