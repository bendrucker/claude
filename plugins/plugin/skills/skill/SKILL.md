---
name: plugin:skill
description: Use when creating a skill, converting a memory file into one, debugging skill activation, or structuring skill content. For prompt wording, pair with prompting:prompting.
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

## Arguments

Run a check against a skill path in `$ARGUMENTS`, defaulting to the skill you just edited:

- `--validate`: run `skill-lint` (see [Validation](#validation)) for frontmatter, naming, and reference depth.
- `--structure`: run `${CLAUDE_SKILL_DIR}/scripts/check-structure.ts` for the SKILL.md, `scripts/`, `references/`, `assets/` layout.

With neither flag, use the skill as an authoring reference.

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
- `effort`: Reasoning effort while the skill is active, applied only when typed as a slash command. Model invocation ignores it. Defaults to the conversation's effort. See [Reasoning Effort](references/patterns.md#reasoning-effort) for levels and cache cost by model.
- `context`: Set to `fork` to run in isolated subagent context
- `agent`: Agent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom)
- `background`: Only with `context: fork`. `false` waits for the fork's result in the invoking turn instead of backgrounding it. Default `true`.
- `user-invocable`: Hide from slash menu when `false` (default: `true`)
- `disable-model-invocation`: Block model (Skill-tool) invocation and drop the skill's name and description from the always-on catalog (zero recurring context cost); still slash-invocable. Opposite of `user-invocable: false`, which hides the slash menu but keeps the description loaded for the model.
- `hooks`: Skill-scoped hooks (`PreToolUse`, `PostToolUse`, `Stop`)

#### Naming

Plugin skills use `plugin-name:skill-name` with a colon namespace (e.g., `gitlab:ci`, `things:url`). The part after the colon should not repeat the plugin name. Skip the prefix when name equals plugin name. For standalone skills, use a specific gerund form (verb + -ing): `processing-pdfs`, `analyzing-data`.

#### Storage

`~/.claude/skills/` (personal), `.claude/skills/` (project), plugins (bundled)

## Skill Authoring Best Practices

Load the `prompting` skill before writing a skill body or a reference file. The sections below cover what is specific to Claude Code skills.

#### Descriptions

The `description` field is the pointer Claude scans to decide whether to activate the skill. Write it for the model and make it slightly pushy, since under-triggering is the common failure.

List triggers: the requests that call for the skill. End with the boundary to any sibling skill a request could land on. Tools, techniques, and capabilities go in the body.

```yaml
description: Use when timing a program or command, asking whether a change or version made it faster, or building a benchmark harness. For repeated optimization toward a target, use performance:hill-climb.
```

#### Gotchas

Record failure modes hit in practice in a `## Gotchas` section, and grow it as edge cases surface.

#### Progressive Disclosure

Keep `SKILL.md` a concise hub and push details into `references/`, `scripts/`, and `assets/`, organized by domain. Point to each file with when to read it.

A model-invocable skill's `description` costs tokens in every session. Keep an invoked skill's body under roughly 4k tokens, since it is re-injected in full at every compaction. A `references/` file costs nothing until its pointer fires.

Split one skill into two by invocation when the branches need different frontmatter: a different `model`, different `allowed-tools`, or one branch routed by the model while the other stays user-invoked.

#### State and Scripts

Store state that must survive plugin upgrades (logs, JSON records, SQLite, a first-run `config.json` of user answers) in `${CLAUDE_PLUGIN_DATA}`. Point to bundled scripts with "Run script.py" to execute and "See script.py" to read.

#### On-Demand Hooks

Skill-scoped hooks activate when the skill is invoked and last for the session. Use them for guardrails that belong only in the skill's context, such as blocking destructive commands during prod operations.

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

Bang-backtick syntax runs a shell command before the skill content reaches Claude and replaces the placeholder with its stdout. Use it for live data every run needs. Syntax and gotchas are in [references/patterns.md](references/patterns.md#dynamic-context-injection).

## Directory Structure

Skills follow the [Agent Skills](https://agentskills.io/specification#optional-directories) directory convention. Only `SKILL.md` is required.

```
skill-name/
├── SKILL.md        # Required: instructions and frontmatter
├── scripts/        # Executable code agents can run (self-contained, explicit errors)
├── references/     # Documentation loaded on demand (focused, domain-named files)
└── assets/         # Static resources (templates, images, data files)
```

A PostToolUse hook validates writes to skill directories against this structure.

### File Naming

Use uppercase only for files with special meaning (`SKILL.md`, `README.md`) and lowercase for the rest. Keep references one level deep.

## Validation

A skill-scoped PostToolUse hook runs `skill-lint` when SKILL.md files are edited. For manual checks, run `bun run skill-lint path/to/skill/` from the project root. A skill is done when `skill-lint` passes and its `SKILL.md` reports under roughly 4k tokens.

## References

- [references/patterns.md](references/patterns.md): dynamic context injection, subagents and `context: fork`, reasoning effort, skill-scoped hooks, tool and skill overlap
- [references/troubleshooting.md](references/troubleshooting.md): activation issues, plugin cache

## Resources

- [Agent Skills Specification](https://agentskills.io/specification)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Agent Skills Best Practices](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/best-practices)
