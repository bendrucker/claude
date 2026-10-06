import type { Rule, RuleResult, SkillContent } from "../types";

const BANG_COMMAND = /!`([^`]+)`/g;
const BASH_ENTRY = /^Bash\((.+)\)$/;

function bangCommands(body: string): string[] {
  const commands: string[] = [];
  for (const match of body.matchAll(BANG_COMMAND)) {
    const command = match[1]?.trim();
    if (command != null && command !== "") commands.push(command);
  }
  return commands;
}

function bashMatchers(allowedTools: unknown): string[] {
  if (!Array.isArray(allowedTools)) return [];
  const matchers: string[] = [];
  for (const tool of allowedTools) {
    if (typeof tool !== "string") continue;
    const match = tool.match(BASH_ENTRY);
    if (match?.[1] != null && match[1] !== "") matchers.push(match[1]);
  }
  return matchers;
}

function matchesBang(matcherCommand: string, commands: string[]): boolean {
  const star = matcherCommand.indexOf("*");
  if (star === -1) return false;
  const prefix = matcherCommand.slice(0, star);
  return commands.some((command) => command.startsWith(prefix));
}

export const bangExecutionMatcher: Rule = {
  name: "bang-execution-matcher",
  severity: "warn",
  check(content: SkillContent): RuleResult {
    const commands = bangCommands(content.body);
    if (commands.length === 0) {
      return {
        rule: "bang-execution-matcher",
        severity: "warn",
        passed: true,
        message: "no bang execution in body",
      };
    }

    const offenders = bashMatchers(content.frontmatter["allowed-tools"])
      .filter((matcher) => matcher.endsWith(":*"))
      .filter((matcher) => matchesBang(matcher.slice(0, -2), commands));

    if (offenders.length > 0) {
      return {
        rule: "bang-execution-matcher",
        severity: "warn",
        passed: false,
        message: `allowed-tools entries end in ":*" but match a bang-executed command: ${offenders
          .map((matcher) => `Bash(${matcher})`)
          .join(
            ", ",
          )}\n  Bang execution includes the !\`\` syntax markers in the checked pattern, so a ":*" argument matcher never matches. Drop the trailing ":*" to use an open glob, e.g. Bash(bun \${CLAUDE_PLUGIN_ROOT}/scripts/*).`,
      };
    }

    return {
      rule: "bang-execution-matcher",
      severity: "warn",
      passed: true,
      message: "bang execution matchers use open globs",
    };
  },
};

export const bangExecutionRules: Rule[] = [bangExecutionMatcher];
