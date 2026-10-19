#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { z } from "zod";

const SUITE = join(import.meta.dirname, "..");

const Label = z.object({
  id: z.string(),
  query: z.string(),
  relevant: z.array(z.object({ session_id: z.string() })),
  tags: z.array(z.string()),
});
type Label = z.infer<typeof Label>;

/** The prompt an agent gets for a label: one session to find, or every session on a topic. */
export function prompt(label: Label): string {
  return label.tags.includes("topical")
    ? `Which sessions were about "${label.query}"? List their session ids.`
    : `Find the session where we worked on "${label.query}". Give its session id.`;
}

export function truth(sessions: string[]): string {
  const rows = sessions.map((s) => `('${s.replaceAll("'", "''")}')`).join(", ");
  return `-- reference: queries/search\\.sql\nSELECT key FROM (VALUES ${rows}) AS t(key);\n`;
}

export function caseYaml(label: Label): string {
  const tags = ["search", ...label.tags].join(", ");
  return `schema_version: "1.1"
name: search-${label.id}
tags: [${tags}]
plugins: ["../../.."]
execution:
  model: claude-sonnet-5-5
  max_turns: 30
  timeout_seconds: 600
  allowed_tools: [Read, Glob, Grep, Skill, Bash]
context:
  scaffold_script: fixture.sh
`;
}

/** Sessions the frozen index holds, so a case never asks about one outside the snapshot. */
async function indexed(index: string, ids: string[]): Promise<Set<string>> {
  const list = ids.map((s) => `'${s.replaceAll("'", "''")}'`).join(", ");
  const sql = `SELECT DISTINCT session_id FROM raw WHERE session_id IN (${list})`;
  const out = await $`duckdb -readonly -json ${index} -c ${sql}`.text();
  const rows = z
    .array(z.object({ session_id: z.string() }))
    .parse(JSON.parse(out.trim() === "" ? "[]" : out));
  return new Set(rows.map((r) => r.session_id));
}

async function writeCase(label: Label, sessions: string[]): Promise<void> {
  const dir = join(SUITE, `search-${label.id}`);
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(join(dir, "case.yaml"), caseYaml(label)),
    Bun.write(join(dir, "prompt.md"), `${prompt(label)}\n`),
    Bun.write(join(dir, "truth.sql"), truth(sessions)),
    Bun.write(join(dir, "fixture.sh"), '#!/usr/bin/env bash\nexec "$(dirname "$0")/../index.sh"\n'),
  ]);
  await $`chmod +x ${join(dir, "fixture.sh")}`;
}

export const program = new Command("search-cases")
  .description(
    "Write a search-<id> case for each labeled search query whose relevant sessions the frozen index holds. The cases hold session text, so they stay out of git.",
  )
  .option("--labels <path>", "labels file", join(SUITE, "../search/labels.jsonl"))
  .option("--index <path>", "frozen index", join(SUITE, "data/session.duckdb"))
  .action(async ({ labels: path, index }) => {
    const labels = (await Bun.file(path).text())
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => Label.parse(JSON.parse(l)));
    const held = await indexed(
      index,
      labels.flatMap((l) => l.relevant.map((r) => r.session_id)),
    );
    const cases = labels
      .map((label) => ({
        label,
        sessions: label.relevant.map((r) => r.session_id).filter((s) => held.has(s)),
      }))
      .filter((c) => c.sessions.length > 0);
    await Promise.all(cases.map((c) => writeCase(c.label, c.sessions)));
    console.log(`${cases.length} of ${labels.length} labels have a session in the index`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
