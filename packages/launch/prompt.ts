import type { PluginEntry } from "./plugins";

export function buildPrompt(task: string, plugins: PluginEntry[]): string {
  const pluginList = plugins.map((p) => `- ${p.id}: ${p.description}`).join("\n");

  return `You are a Claude Code session configurator. Given a task description, select the optimal configuration.

## Task

${task}

## Enabled Plugins

${pluginList}

## Selection Guidance

### Model
- **opus**: Architecture, design, hard debugging, complex refactors, multi-system coordination
- **sonnet**: Routine development, feature implementation, code review, standard fixes
- **haiku**: Simple lookups, quick questions, trivial edits

### Effort
- **high**: Multi-step architectural tasks, complex debugging, large refactors
- **medium**: Standard feature work, bug fixes, code review (default)
- **low**: Trivial fixes, typos, simple lookups

### Plugins
Disable aggressively — every enabled plugin adds context overhead.

**Always keep enabled** (never list in disablePlugins):
- style@bendrucker
- newline@bendrucker
- claude-code@bendrucker
- plan@bendrucker
- pull-request@bendrucker
- git@bendrucker

**Disable** plugins for:
- Languages not relevant to the task (e.g. go@ for a TypeScript task)
- Services not mentioned or implied (e.g. gitlab@, terraform@, calendar@, things@)
- Workflows not needed (e.g. personal-review@, interview@, research@)

### Tools
Pre-approve tools the task will clearly need. Common patterns:
- \`Bash(git:*)\` — any git work
- \`Bash(go:*)\` — Go development
- \`Bash(bun:*)\` — Bun/TypeScript development
- \`Bash(npm:*)\` — Node.js development
- \`Bash(gh:*)\` — GitHub CLI operations
- \`Bash(glab:*)\` — GitLab CLI operations

### Permission Mode
- **plan**: Complex multi-step tasks, architectural changes, unfamiliar codebases
- **default**: Routine work, well-understood tasks

### Branch Name
Generate a concise branch name for the task using conventional prefixes: \`fix/\`, \`feat/\`, \`refactor/\`, \`chore/\`. Use lowercase kebab-case (e.g. \`fix/auth-token-expiry\`, \`feat/api-users-endpoint\`).

### System Prompt
Only set when the task benefits from specific framing or constraints. Leave unset for most tasks.

## Output

Return a JSON object with your configuration choices.`;
}
