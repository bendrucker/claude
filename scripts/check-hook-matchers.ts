#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import {
  type HooksFile,
  loadPlugins,
  MatcherEntry,
  type MatcherEntryContext,
  matcherEntries,
} from "../packages/marketplace/index";
import { root } from "./assets";
import { runCheck } from "./check";
import { SOURCES } from "./check-hook-paths";

const SettingsHooks = z.looseObject({
  hooks: z.record(z.string(), z.array(MatcherEntry)).optional(),
});

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

function* settingsEntries(file: string, hooks: HooksFile["hooks"]): Generator<MatcherEntryContext> {
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) yield { file, entry };
  }
}

/**
 * Matcher entries from every plugin plus both settings files. Roughly half this
 * repo's hook entries live in settings rather than a plugin, and a matcher
 * defect is equally silent in either.
 */
function toArray<T>(items: Iterable<T>): T[] {
  return [...items];
}

export async function allMatcherEntries(): Promise<MatcherEntryContext[]> {
  const [plugins, settings] = await Promise.all([
    loadPlugins(),
    Promise.all(
      SOURCES.map(async ({ file }) => {
        const parsed = await decodeFile(SettingsHooks, join(root, file));
        return toArray(settingsEntries(file, parsed.hooks ?? {}));
      }),
    ),
  ]);
  return [...plugins.flatMap((plugin) => toArray(matcherEntries(plugin))), ...settings.flat()];
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: "Hook matchers that cannot fire:",
      violations: violations(await allMatcherEntries()),
    }),
    { success: 'All hook matchers match tool names and every "if" holds one permission rule' },
  );
}
