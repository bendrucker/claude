#!/usr/bin/env bun

import {
  loadPlugins,
  type MatcherEntryContext,
  matcherEntries,
} from "../packages/marketplace/index";
import { runCheck } from "./check";

/** A `Tool(...)` permission rule: legal in an `if`, never in a matcher. */
const PERMISSION_RULE = /^[A-Za-z_]\w*\(.*\)$/;

/** A lone `Tool` or `Tool(specifier)` token, the only shape an `if` accepts. */
const SINGLE_RULE = /^[A-Za-z_][\w-]*(\([^()]*\))?$/;

/** WebFetch rules match hostnames only, via a `domain:` specifier. */
const WEBFETCH_RULE = /^WebFetch\(domain:[^\s()]+\)$/;

/**
 * Matcher and `if` defects across a set of hook entries.
 *
 * A matcher is a regex over tool names, so `Bash(gh pr create:*)` there is a
 * pattern that no tool name can satisfy and the hook never fires. Command
 * scoping belongs in a per-command `if`, which holds exactly one permission
 * rule and rejects the pipe-joined alternation a matcher allows.
 */
export function violations(entries: MatcherEntryContext[]): string[] {
  const messages: string[] = [];

  for (const { file, entry } of entries) {
    for (const segment of entry.matcher?.split("|") ?? []) {
      if (!PERMISSION_RULE.test(segment)) continue;
      messages.push(
        `${file}: matcher "${entry.matcher}" uses permission-rule syntax and can never match a tool name. Move command scoping to a per-hook "if" field.`,
      );
      break;
    }

    for (const command of entry.hooks) {
      if (command.if === undefined) continue;
      if (!SINGLE_RULE.test(command.if)) {
        messages.push(`${file}: "if" must be exactly one permission rule, got "${command.if}"`);
        continue;
      }
      if (command.if.startsWith("WebFetch(") && !WEBFETCH_RULE.test(command.if)) {
        messages.push(
          `${file}: WebFetch rules match hostnames only. Rewrite "${command.if}" as WebFetch(domain:<host>).`,
        );
      }
    }
  }

  return messages;
}

export async function entries(): Promise<MatcherEntryContext[]> {
  const plugins = await loadPlugins();
  return plugins.flatMap((plugin) => [...matcherEntries(plugin)]);
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: "Hook matchers that cannot fire:",
      violations: violations(await entries()),
    }),
    { success: 'All hook matchers match tool names and every "if" holds one permission rule' },
  );
}
