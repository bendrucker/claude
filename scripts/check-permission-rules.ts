#!/usr/bin/env bun

import { join } from "node:path";
import matter from "gray-matter";
import { runCheck, tracked } from "./check";

// Claude Code warns on startup about Write(path), NotebookEdit(path), and
// Glob(path) permission rules: the permission system routes file writes
// through Edit(path) rules and Glob through Read(path) rules, so these forms
// never match. Hook matchers and `if` conditions are exempt because hooks
// match the tool actually invoked.
const DEPRECATED = /^(Write|NotebookEdit|Glob)\(/;

const REPLACEMENT: Record<string, string> = {
  Write: "Edit",
  NotebookEdit: "Edit",
  Glob: "Read",
};

const root = join(import.meta.dirname, "..");

function deprecatedRules(rules: string[]): string[] {
  return rules.filter((rule) => DEPRECATED.test(rule));
}

function describe(file: string, context: string, rule: string): string {
  const tool = rule.slice(0, rule.indexOf("("));
  return `${file} (${context}): ${rule} (use ${REPLACEMENT[tool]}(...) instead)`;
}

interface Permissions {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

async function checkSettings(): Promise<string[]> {
  const violations: string[] = [];

  for (const file of await tracked("*settings*.json", root)) {
    const parsed: unknown = await Bun.file(join(root, file)).json();
    if (typeof parsed !== "object" || parsed === null) continue;

    const permissions = (parsed as Record<string, unknown>).permissions as Permissions | undefined;
    if (!permissions) continue;

    for (const list of ["allow", "deny", "ask"] as const) {
      for (const rule of deprecatedRules(permissions[list] ?? [])) {
        violations.push(describe(file, `permissions.${list}`, rule));
      }
    }
  }

  return violations;
}

function frontmatterRules(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((rule) => rule.trim());
  if (Array.isArray(value)) return value.filter((rule) => typeof rule === "string");
  return [];
}

async function checkFrontmatter(): Promise<string[]> {
  const violations: string[] = [];

  for (const file of await tracked("*.md", root)) {
    const raw = await Bun.file(join(root, file)).text();
    if (!raw.startsWith("---")) continue;

    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      violations.push(`${file}: frontmatter failed to parse (${message})`);
      continue;
    }

    for (const key of ["allowed-tools", "tools"]) {
      for (const rule of deprecatedRules(frontmatterRules(data[key]))) {
        violations.push(describe(file, key, rule));
      }
    }
  }

  return violations;
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: [
        "Deprecated permission rules (Write/NotebookEdit rules are evaluated as Edit,",
        "Glob rules as Read, so these forms never match):",
      ],
      violations: [...(await checkSettings()), ...(await checkFrontmatter())],
    }),
    { success: "No deprecated Write/NotebookEdit/Glob permission rules" },
  );
}
