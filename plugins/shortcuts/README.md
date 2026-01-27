# Shortcuts Plugin

Creating Apple Shortcuts programmatically as plist XML.

## Contents

- **Skill: shortcut** — Generate, sign, and deploy Apple Shortcuts
- **Script: discover.swift** — Enumerate available actions on macOS

## Approach

`.shortcut` files are binary plists. This skill generates XML plists (human-readable, zero dependencies) and converts with `plutil`. Alternatives considered: [Cherri](https://cherrilang.org/) (Go, type-safe, adds dependency), [shortcuts-js](https://github.com/joshfarrant/shortcuts-js) (abandoned), [ScPL](https://github.com/pfgithub/scpl) (abandoned).

### Workflow

**Discovery** → **Generation** → **Deployment**

- **Discovery**: `discover.swift` reads `WFActions.plist` from `WorkflowKit.framework`. On Linux, fall back to static references.
- **Generation**: Write XML plist. References split by topic — load only what's needed.
- **Deployment** (macOS): `plutil` → `shortcuts sign` → `shortcuts import` → `shortcuts run`.

### Discovery CLI

Interpreted Swift, macOS frameworks only, JSON output. Same pattern as Calendar plugin's `cal.swift`.

| Command | Purpose |
|---------|---------|
| `list [--category <name>]` | All built-in action identifiers |
| `describe <identifier>` | Parameters, input/output types |
| `search <query>` | Search identifiers, descriptions, keywords |
| `categories` | Category list with counts |
| `apps` | Installed apps with Shortcuts support |

### OS Detection

`uname -s` → **Darwin**: full pipeline. **Linux**: generate XML only.

### References

| File | Topic |
|------|-------|
| `discovery.md` | discover.swift CLI |
| `actions.md` | Static action catalog |
| `plist-structure.md` | Top-level keys, icon, types |
| `control-flow.md` | If/else, repeat, menu XML |
| `variables.md` | Set/get, output UUIDs, token strings |
| `parameters.md` | Value types, serialization |
| `deployment.md` | Convert, sign, import, run |

## Resources

- [Shortcuts File Format](https://zachary7829.github.io/blog/shortcuts/fileformat) — most thorough format docs
- [iOS-Shortcuts-Reference](https://github.com/sebj/iOS-Shortcuts-Reference) — file structure (archived 2022)
- [Cherri Docs](https://cherrilang.org/compiler/file-format.html) — compiler-perspective format overview
- [WorkflowKit.framework](https://theapplewiki.com/wiki/Dev:WorkflowKit.framework) — framework internals
- [macOS `shortcuts` CLI](https://ss64.com/mac/shortcuts.html) — man page
- [0xdevalias Gist](https://gist.github.com/0xdevalias/27d9aea9529be7b6ce59055332a94477) — decompilation workflows

The authoritative action list is `WFActions.plist` in `/System/Library/PrivateFrameworks/WorkflowKit.framework/`. The `discover.swift` CLI reads this.

## Open Questions

- **Testing**: No automated tests. Options: `plutil -lint` validation, XML structure unit tests, macOS CI end-to-end.
- **Third-party actions**: `discover.swift apps` finds apps with Shortcuts support but can't list individual actions. `Metadata.appintents` is opaque. Export an existing shortcut and inspect the plist.
- **discover.swift**: Needs real-world macOS testing against actual `WFActions.plist`.
- **Cherri**: Could generate Cherri code for type safety, adds a dependency.
