#!/usr/bin/env bun

import { globSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const root = join(import.meta.dirname, "..");

interface SkillEntry {
  path: string;
  name: string;
  description: string;
  chars: number;
  tokens: number;
  userInvocable: boolean | undefined;
  disableModelInvocation: boolean | undefined;
  flags: string[];
}

const files = globSync("plugins/*/skills/*/SKILL.md", { cwd: root });
const entries: SkillEntry[] = [];

for (const file of files) {
  if (file.includes("/test/")) continue;

  const raw = await Bun.file(join(root, file)).text();
  const { data } = matter(raw);
  const name = (data.name as string) ?? "(unnamed)";
  const description = String(data.description ?? "").trim();
  const chars = description.length;
  const tokens = Math.ceil(chars / 4);
  const userInvocable = data["user-invocable"] as boolean | undefined;
  const disableModelInvocation = data["disable-model-invocation"] as boolean | undefined;

  const flags: string[] = [];

  if (userInvocable === false && !disableModelInvocation) {
    flags.push("hidden-but-model-invocable");
  }

  if (disableModelInvocation && userInvocable === false) {
    flags.push("fully-hidden");
  }

  if (!disableModelInvocation && chars > 200) {
    flags.push("verbose");
  }

  entries.push({
    path: file,
    name,
    description,
    chars,
    tokens,
    userInvocable,
    disableModelInvocation,
    flags,
  });
}

entries.sort((a, b) => b.chars - a.chars);

const modelInvocable = entries.filter((e) => !e.disableModelInvocation);
const totalChars = modelInvocable.reduce((sum, e) => sum + e.chars, 0);
const totalTokens = modelInvocable.reduce((sum, e) => sum + e.tokens, 0);

console.log(`## Description Budget: ${totalChars} chars (~${totalTokens} tokens)\n`);
console.log(
  `${modelInvocable.length} skills with model-invocable descriptions (${entries.length} total)\n`,
);

console.log("| Chars | Tokens | Skill | Flags |");
console.log("|------:|-------:|-------|-------|");

for (const entry of modelInvocable) {
  const flags = entry.flags.length > 0 ? entry.flags.join(", ") : "";
  console.log(`| ${entry.chars} | ${entry.tokens} | ${entry.name} | ${flags} |`);
}

const flagged = entries.filter((e) => e.flags.length > 0);
if (flagged.length > 0) {
  console.log(`\n## Flagged (${flagged.length})\n`);
  for (const entry of flagged) {
    console.log(`- **${entry.name}** (${entry.path}): ${entry.flags.join(", ")}`);
  }
}
