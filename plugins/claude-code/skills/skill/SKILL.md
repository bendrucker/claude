---
name: claude-code:skill
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
argument-hint: "[--validate] [--structure]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - WebFetch(domain:docs.claude.com)
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-namespace.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-structure.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-lint.ts"
---

# Claude Code Skills Development

Reference for developing effective skills.

## Arguments

Run a check against a skill path in `$ARGUMENTS`, defaulting to the skill you just edited:

- `--validate`: run `skill-lint` (see [Validation](#validation)) for frontmatter, naming, and reference-depth validation.
- `--structure`: run the directory-structure check (`${CLAUDE_SKILL_DIR}/scripts/check-structure.ts`) for the SKILL.md, `scripts/`, `references/`, `assets/` layout.

With neither flag, use the skill as an authoring reference. See [Validation](#validation).

## Skill Structure

```yaml
---
name: plugin-name:skill-name
description: Third-person capability description with trigger terms
argument-hint: "[--flag] [<positional>]"
allowed-tools: [Read, Grep, Glob]
model: sonnet
effort: low
context: fork
agent: Explore
background: false
user-invocable: false
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
          once: true
---
```

#### Required Fields

- `name`: Lowercase letters, numbers, hyphens only (max 64 chars). See [Naming](#naming).
- `description`: Third-person, includes trigger terms and use cases (max 1024 chars).

#### Optional Fields

- `argument-hint`: Arguments the skill accepts, shown in the slash menu after the skill name. See [Argument Hints](#argument-hints).
- `allowed-tools`: Tools Claude can use without permission when skill is active
- `model`: Override the conversation's model. Prefer a tier alias (`haiku`, `sonnet`, `opus`, `fable`) or `inherit` over a dated model ID.
- `effort`: Reasoning effort while the skill is active. Pin `low` on mechanical skills such as monitoring, execution, and formatting. Defaults to the conversation's effort.
- `context`: Set to `fork` to run in isolated subagent context
- `agent`: Agent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom)
- `background`: Only with `context: fork`. `false` waits for the fork's result in the invoking turn instead of backgrounding it. Default `true`.
- `user-invocable`: Hide from slash menu when `false` (default: `true`)
- `disable-model-invocation`: Block model (Skill-tool) invocation and drop the skill's name and description from the always-on catalog (zero recurring context cost); still slash-invocable. Opposite of `user-invocable: false`, which hides the slash menu but keeps the description loaded for the model.
- `hooks`: Skill-scoped hooks (`PreToolUse`, `PostToolUse`, `Stop`)

#### Naming

Plugin skills use `plugin-name:skill-name` with a colon namespace (e.g., `gitlab:ci`, `things:url`). The part after the colon should not repeat the plugin name. Skip the prefix when name equals plugin name. For standalone skills, use gerund form (verb + -ing): `processing-pdfs`, `analyzing-data`. Avoid vague names like `helper`, `utils`.

#### Storage

`~/.claude/skills/` (personal), `.claude/skills/` (project), plugins (bundled)

## Skill Authoring Best Practices

#### Descriptions

The description field is a trigger, not a summary. It's what Claude scans to decide whether to activate the skill. Write it for the model: trigger terms, use cases, and "Use when..." phrasing. Make it slightly pushy to combat under-triggering.

#### Skip the Obvious

The context window is a public good. Don't restate what Claude already knows. Spend tokens on what pushes Claude out of its defaults: gotchas, internal conventions, non-obvious constraints. The highest-signal content in any skill is a `## Gotchas` section documenting failure modes hit in practice; grow it as edge cases surface.

#### Plain Language

Write skill prose as instructions, in the imperative, with conditions before instructions and common verbs. Metaphor, epigram, and personification aim at a human reader and make weaker match targets than literal statements. See [references/plain-language.md](references/plain-language.md) for the sentence forms, the conversions, and the procedure for converting an existing skill.

#### Progressive Disclosure

A skill is a folder, not just a markdown file. Keep `SKILL.md` a concise hub and push details into `references/`, `scripts/`, and `assets/`. Tell Claude what files exist and when to read them. Organize references by domain and gate conditional detail behind a pointer, so a question about one domain loads only that file.

The pointer's wording decides whether Claude reaches the file at all, so sharpen the wording before concluding that material has to be inlined. See [references/information-hierarchy.md](references/information-hierarchy.md) for the two budgets a document spends, the ladder each piece sits on, co-location, and when a document earns a split.

#### Don't Railroad Claude

State the goal and constraints, then leave room to adapt. Prefer outcome-oriented instructions over step-by-step scripts.

Goal and constraints still need a done-state: the observable condition that says the work is finished. A vague one lets Claude stop early. A demanding one ("every modified model accounted for") drives thorough work without adding a step, and it binds a body of flat reference the same way it binds a sequence. See [references/levers.md](references/levers.md) for completion criteria, leading words, and pruning.

#### First-Run Setup

Skills that depend on user-specific context should check for a `config.json` in `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_DATA}`. If missing, prompt the user for setup and store answers for future runs.

#### Store Persistent Data in `${CLAUDE_PLUGIN_DATA}`

Skills can maintain state across runs: append-only logs, JSON records, SQLite databases. Use `${CLAUDE_PLUGIN_DATA}` for storage that survives plugin upgrades.

#### Give Claude Code to Compose

Include helper scripts and libraries that Claude can import and compose on the fly. Document scripts with `"Run script.py"` (execute) vs `"See script.py"` (reference).

#### On-Demand Hooks

Skill-scoped hooks activate only when the skill is invoked and last for the session. Use these for guardrails that would be annoying globally but valuable in specific contexts (e.g., blocking destructive commands during prod operations).

## Content Features

### String Substitutions

| Variable               | Description                                                                      |
| :---------------------- | :------------------------------------------------------------------------------- |
| `$ARGUMENTS`           | All arguments passed when invoking the skill. Appended automatically if absent.  |
| `$ARGUMENTS[N]` / `$N` | Access a specific argument by 0-based index.                                     |
| `${CLAUDE_SESSION_ID}` | Current session ID.                                                              |
| `${CLAUDE_SKILL_DIR}` | Absolute path to the skill's directory. Substituted in skill content: the body, `!` injection commands, and `allowed-tools`. |

These substitutions apply to skill content, not the frontmatter `hooks:` block. The hooks engine expands only `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PLUGIN_DATA}` ([hooks reference](https://code.claude.com/docs/en/hooks)); `${CLAUDE_SKILL_DIR}` there resolves to an empty string. In a hook command, reference a bundled script by plugin root instead: `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/scripts/check.ts`.

### Argument Hints

`argument-hint` declares the arguments a skill accepts. It renders in the slash menu after the skill name and reminds the user which flags exist. Give every directable skill a hint, even when it usually runs with none. A skill that branches internally ("if the user wants X") should expose that branch as a flag.

#### Notation

- Required tokens use angle brackets, optional tokens use square brackets: `<doc-path> [--draft]`.
- Mutually-exclusive alternatives are pipe-separated with surrounding spaces: `[staged | <range> | HEAD]`.
- Boolean flags are `[--flag]`. Value flags are `[--flag value]`. Enumerated values pipe-join without inner spaces: `[--role author|reviewer]`.
- Order tokens as required positionals, then optional positionals, then flags.

#### Parsing

A skill that declares an `argument-hint` must parse `$ARGUMENTS` (or `$0`/`$1` for positionals) and act on what it finds. Add an `## Arguments` section to the body mapping each token to its behavior, with a stated default for every flag so the no-argument invocation stays well-defined.

### Dynamic Context Injection

The bang-backtick syntax runs shell commands **before** the skill content is sent to Claude. The output replaces the placeholder — Claude sees only the result, not the command. This is preprocessing, not something Claude executes. Use it to inject live data (git state, CLI output, file contents) so the harness extracts and runs the commands without waiting on the model.

See [references/patterns.md](references/patterns.md) for syntax, examples, and gotchas.

## Directory Structure

Skills follow the [Agent Skills](https://agentskills.io/specification#optional-directories) directory convention. Only `SKILL.md` is required; all directories are optional.

```
skill-name/
├── SKILL.md        # Required: instructions and frontmatter
├── scripts/        # Executable code agents can run (self-contained, explicit errors)
├── references/     # Documentation loaded on demand (focused, domain-named files)
└── assets/         # Static resources (templates, images, data files)
```

A PostToolUse hook validates writes to skill directories against this structure.

### File Naming

Reserve ALL CAPS for files with special meaning (`SKILL.md`, `README.md`). Use lowercase for all other files. Keep references one level deep.

## Validation

A skill-scoped PostToolUse hook runs `skill-lint` automatically when SKILL.md files are edited. For manual checks, run `bun run skill-lint path/to/skill/` from the project root.

## References

Load detailed guides as needed:

- **[references/information-hierarchy.md](references/information-hierarchy.md)** - Context and cognitive load, context pointers, the step/reference ladder, progressive disclosure, co-location, splitting
- **[references/levers.md](references/levers.md)** - Completion criteria, leading words, the positive form, pruning
- **[references/patterns.md](references/patterns.md)** - Dynamic context injection, subagent integration, skill-scoped hooks, anti-patterns
- **[references/plain-language.md](references/plain-language.md)** - Plain-language rules for skill prose and the conversion procedure
- **[references/troubleshooting.md](references/troubleshooting.md)** - Activation issues, plugin cache

## Resources

- [Agent Skills Specification](https://agentskills.io/specification)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Agent Skills Best Practices](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/best-practices)
