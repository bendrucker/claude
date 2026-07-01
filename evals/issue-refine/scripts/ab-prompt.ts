#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";

// Assembles the agent prompt for one A/B cell: a skill version (a directory of
// SKILL.md + guide files) run against one synthetic brief. The agent identifies
// the type itself and emits only the finished issue, so a version that lacks a
// guide (e.g. before spike.md existed) simply cannot pick that type.

const argv = cli({
  name: "ab-prompt",
  flags: {
    version: { type: String, description: "Directory of skill files (SKILL.md + guides)" },
    brief: { type: String, description: "Path to a brief JSON file" },
  },
});

if (!argv.flags.version || !argv.flags.brief) {
  console.error("usage: ab-prompt --version <dir> --brief <file.json>");
  process.exit(1);
}

const brief = await Bun.file(argv.flags.brief).json();
const files = (await readdir(argv.flags.version)).filter((f) => f.endsWith(".md")).sort();

const skillBlocks: string[] = [];
for (const f of files) {
  const body = await Bun.file(join(argv.flags.version, f)).text();
  skillBlocks.push(`================ ${f} ================\n${body.trim()}`);
}

const ctx = brief.context ?? {};
const files_ctx = (ctx.files ?? []).map((x: string) => `- ${x}`).join("\n");
const issues_ctx = (ctx.related_issues ?? []).map((x: string) => `- ${x}`).join("\n");

const prompt = `You are the issue:refine skill. Refine the brief below into a structured issue by following the skill instructions verbatim.

Rules for this run:
- Use ONLY the brief and synthetic context below. Do not call tools or gather external context. Treat the listed files and related issues as what you found when investigating.
- Identify the issue type yourself from the skill's Issue Types, then follow the matching guide.
- The tracker is a Linear-style tracker: a reference written as a markdown link expands into an inline chip. Relation links under \`relations:\` are those links.
- Output ONLY the finished issue as a Markdown artifact: YAML frontmatter between \`---\` fences (\`title\`, \`type\`, and any of \`labels\`, \`priority\`, \`relations\` you can fill), then the body below the closing \`---\`. The body opens with the summary prose directly. Do not put a \`# H1\` heading in the body. No preamble, no "for approval" question, no commentary.

${skillBlocks.join("\n\n")}

================ BRIEF ================
${brief.brief}

================ SYNTHETIC CONTEXT ================
Files:
${files_ctx || "(none)"}

Related issues:
${issues_ctx || "(none)"}
`;

console.log(prompt);
