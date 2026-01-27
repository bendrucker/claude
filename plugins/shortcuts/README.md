# Shortcuts Plugin

Creating and running Apple Shortcuts programmatically.

## Contents

- **Skill: shortcut** — Author shortcuts as plist XML, discover actions, deploy
- **Skill: cli** — Run, list, and manage shortcuts via the `shortcuts` CLI
- **Script: discover.swift** — Enumerate available actions on macOS
- **Hook: open** — Gates `open` command to `.shortcut` files only

## Approach

`.shortcut` files are binary plists. The `shortcut` skill generates XML plists (human-readable, zero dependencies) and converts with `plutil`. The `cli` skill covers the `shortcuts` command for running and managing shortcuts.

### Workflow

**Discovery** → **Generation** → **Deployment** → **Run**

- **Discovery**: `discover.swift` uses WorkflowKit's runtime API (`WFActionRegistry`) to enumerate actions. On Linux, fall back to static references.
- **Generation**: Write XML plist. References split by topic — load only what's needed.
- **Deployment** (macOS): `plutil` → `shortcuts sign` → `open` (import).
- **Run**: `shortcuts run` executes by name or identifier.

### Discovery CLI

Interpreted Swift, macOS frameworks only, JSON output composed with `jq`.

| Command | Purpose |
|---------|---------|
| `actions` | All built-in actions with parameters |
| `apps` | Installed apps with Shortcuts support |

Filter and search via `jq` pipes. See `discovery.md` for examples.

### References

| File | Topic |
|------|-------|
| `discovery.md` | discover.swift CLI and jq patterns |
| `actions.md` | Static action catalog |
| `plist-structure.md` | Top-level keys, icon, types |
| `control-flow.md` | If/else, repeat, menu XML |
| `variables.md` | Set/get, output UUIDs, token strings |
| `parameters.md` | Value types, serialization |
| `deployment.md` | Convert, sign, import, iterate |

## Resources

- [Shortcuts File Format](https://zachary7829.github.io/blog/shortcuts/fileformat) — most thorough format docs
- [iOS-Shortcuts-Reference](https://github.com/sebj/iOS-Shortcuts-Reference) — file structure (archived 2022)
- [Cherri Docs](https://cherrilang.org/compiler/file-format.html) — compiler-perspective format overview
- [WorkflowKit.framework](https://theapplewiki.com/wiki/Dev:WorkflowKit.framework) — framework internals
- [macOS `shortcuts` CLI](https://ss64.com/mac/shortcuts.html) — man page

## Testing

- **Hook tests**: `hooks/open.test.ts` — unit tests for the `open` command gate. Run with `npm test -- plugins/shortcuts/hooks`.
- **Discovery tests**: `tests/discover.integration.ts` — integration tests for `discover.swift` output. **Run locally only** — requires WorkflowKit, a private Apple framework unavailable on CI runners. Run with `npm run test:integration -- plugins/shortcuts/`.

## Open Questions

- **Shortcut generation tests**: No automated tests for shortcut generation. Options: `plutil -lint` validation, XML structure unit tests.
- **Third-party actions**: `discover.swift apps` finds apps with Shortcuts support but can't list individual actions. `Metadata.appintents` is opaque. Create a shortcut in the GUI, then inspect with `shortcuts view`.
