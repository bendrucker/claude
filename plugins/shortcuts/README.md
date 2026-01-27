# Shortcuts Plugin

Creating Apple Shortcuts programmatically as plist XML.

## Contents

- **Skill: shortcut** — Generating, signing, and deploying Apple Shortcuts from code
- **Script: discover.swift** — Swift CLI for enumerating available Shortcuts actions on macOS

## Testing

On macOS, shortcuts can be signed, imported, and run via the `shortcuts` CLI. On other platforms, generate the plist XML and hand off to the user. No automated tests yet — see Open Questions below.

## Approach

### Why XML Plist

A `.shortcut` file is a binary property list. Apple never published a public spec, but the community has thoroughly reverse-engineered the format. The structure hasn't changed since the Workflow app days — keys are still `WF`-prefixed.

The approach this skill takes is to generate shortcuts as **XML plist** files. XML is human-readable, diffable, and straightforward for an LLM to produce. The `plutil` tool on macOS converts XML to binary, and the `shortcuts` CLI handles signing and import.

### Alternatives Considered

| Tool | Language | Pros | Cons |
|------|----------|------|------|
| **Raw XML plist** (chosen) | XML | No dependencies, Claude generates directly, human-readable | Verbose, no validation |
| [Cherri](https://cherrilang.org/) | Go (compiled) | Purpose-built language, type checking, signing built in | Requires Go/Homebrew install, extra compilation step |
| [shortcuts-js](https://github.com/joshfarrant/shortcuts-js) | JS/TS | npm ecosystem, TypeScript types | Incomplete action coverage, unmaintained (iOS 12 era) |
| [ScPL](https://github.com/pfgithub/scpl) | TS | Text-based shortcut language | Abandoned, no iOS 13+ support |

Raw XML was chosen because it has zero dependencies and lets Claude produce the file directly. Cherri is the most promising alternative — if it were pre-installed, a Cherri-based approach would give type checking and built-in signing. A future iteration could add Cherri support as an optional path.

### Phases

The skill is structured as three phases:

1. **Discovery** — Detect the OS, find available actions. On macOS, the `discover.swift` CLI reads `WFActions.plist` from Apple's private `WorkflowKit.framework` to enumerate all built-in actions with their identifiers, descriptions, and parameters. It also scans installed apps for App Intents metadata. On Linux, fall back on the static reference files.

2. **Generation** — Write the shortcut as an XML plist. Reference files are split by topic (progressive disclosure): plist structure, control flow, variables, parameters, and a static action catalog. Claude loads only the reference needed for the current task.

3. **Deployment** (macOS only) — Convert XML to binary plist (`plutil`), sign (`shortcuts sign`), import (`shortcuts import`), run (`shortcuts run`).

```
Phase 1: Discovery
  uname -s → Darwin? ──► discover.swift list/search/describe
                 └─ Linux? ──► Use static references only

Phase 2: Generation
  Load topic-specific references as needed
  Write XML plist with WFWorkflowActions array

Phase 3: Deployment (macOS only)
  plutil → shortcuts sign → shortcuts import → shortcuts run
```

### Discovery CLI

`discover.swift` is a raw Swift script (no build step) that reads `WFActions.plist` from `WorkflowKit.framework`. Commands:

| Command | Purpose |
|---------|---------|
| `list` | List all built-in action identifiers |
| `list --category <name>` | Filter by category |
| `describe <identifier>` | Full details: parameters, input/output types |
| `search <query>` | Search by identifier, description, keywords |
| `categories` | List action categories with counts |
| `apps` | List installed apps with Shortcuts support |

Follows the same pattern as the Calendar plugin's `cal.swift` — interpreted directly by Swift, macOS built-in frameworks only, JSON output.

### OS Detection

Claude runs `uname -s` before any shortcut operations:

- **Darwin** → macOS: all three phases available
- **Linux** or other → no Shortcuts app: Phase 1 uses static references only, Phase 2 generates the XML plist, Phase 3 is unavailable (user transfers the file to a Mac)

This matters because Claude Code sessions may run on a cloud VM (Linux) where there's no macOS Shortcuts infrastructure. The skill degrades gracefully rather than failing with confusing errors.

### Signing

Shortcuts must be signed before import. Signing is only available via:

1. `shortcuts sign` CLI on macOS (sends to Apple for validation)
2. [HubSign](https://routinehub.co) remote signing service (used by Cherri on non-macOS)

The skill currently only supports macOS signing. HubSign could be added as a fallback for Linux environments.

### Progressive Disclosure

The skill uses topic-specific reference files so Claude only loads what it needs:

| Reference | When to load |
|-----------|-------------|
| `discovery.md` | Looking for available actions on macOS |
| `actions.md` | Need the static action catalog (any platform) |
| `plist-structure.md` | Starting a new shortcut (top-level keys, icon, types) |
| `control-flow.md` | Writing if/else, repeat, menu blocks |
| `variables.md` | Passing data between actions |
| `parameters.md` | Complex parameter encoding (serialization types) |
| `deployment.md` | Converting, signing, importing, running |

## Key Resources

These are the primary references the skill's reference files were built from:

- [Shortcuts File Format Documentation](https://zachary7829.github.io/blog/shortcuts/fileformat) — the most thorough format docs
- [iOS-Shortcuts-Reference](https://github.com/sebj/iOS-Shortcuts-Reference) — file structure reference (archived 2022, pre-signing)
- [Cherri File Format Docs](https://cherrilang.org/compiler/file-format.html) — concise format overview from the compiler perspective
- [0xdevalias Gist](https://gist.github.com/0xdevalias/27d9aea9529be7b6ce59055332a94477) — practical decompilation workflows
- [The Apple Wiki: WorkflowKit.framework](https://theapplewiki.com/wiki/Dev:WorkflowKit.framework) — framework internals
- [macOS `shortcuts` CLI](https://ss64.com/mac/shortcuts.html) — man page reference
- [Apple Support: Run shortcuts from CLI](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac)
- [Cherri Language](https://cherrilang.org/) — the most mature Shortcuts-as-code tool
- [shortcuts-js](https://github.com/joshfarrant/shortcuts-js) — JS library (historical interest)

### Authoritative Action List

No public web resource has a complete, current list of action identifiers. The authoritative source is `WFActions.plist` inside Apple's private `WorkflowKit.framework`:

```
/System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist
```

The `discover.swift` CLI reads this file. To manually inspect it:

```bash
plutil -convert xml1 -o /tmp/WFActions.xml /System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist
```

## Open Questions

- **Testing**: How to test shortcut generation without macOS? Possibilities:
  - Validate the XML plist structure with `plutil -lint` (macOS only, but could validate format)
  - Write unit tests that verify generated XML matches expected structure (platform-independent)
  - On macOS CI: generate, sign, import, run a simple shortcut end-to-end
- **Cherri integration**: Should the skill support generating Cherri code as an alternative to raw XML plist? Cherri provides type safety and simpler syntax, but adds a dependency.
- **Third-party app action enumeration**: `discover.swift apps` finds apps with Shortcuts support but can't enumerate their individual actions. The `Metadata.appintents` format is opaque. Best current approach: export an existing shortcut that uses the app and inspect the plist.
- **Variable handling**: The `WFTextTokenString` / `attachmentsByRange` pattern for inline variable references is complex. For an initial version, the skill recommends using `Set Variable` / `Get Variable` actions instead. Inline variables would improve output quality for complex shortcuts.
- **discover.swift testing**: The Swift script needs real-world testing on macOS to verify it can read `WFActions.plist` and produce useful output. The JSON serialization is manual and may need refinement based on the actual plist structure.
