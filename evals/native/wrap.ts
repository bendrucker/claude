#!/usr/bin/env bun
import { globSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, relative } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import type { Link } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { isMap, parseDocument } from "yaml";
import { stage } from "./stage";

export interface WrapOptions {
  /** Repository to read from. */
  repo: string;
  /** Git ref to read the artifacts at, or the working tree when absent. */
  ref?: string | undefined;
  out: string;
  name: string;
  skills: string[];
  agents: string[];
  /** Documents injected at session start, standing in for CLAUDE.md or a rule file. */
  context: string[];
  /** Suite directory copied to `evals/` so `claude plugin eval` finds it below the plugin. */
  evals?: string | undefined;
}

// The runner ignores a CLAUDE.md or .claude/rules in the scaffolded working directory,
// so context reaches the session the way a plugin can deliver it: a SessionStart hook.
const hooks = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command:
              'cat "$CLAUDE_PLUGIN_ROOT"/context/* | jq -Rs \'{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}\'',
          },
        ],
      },
    ],
  },
};

/**
 * Drops `disable-model-invocation` from a skill's frontmatter. A user-invoked skill otherwise
 * never loads from a natural-language prompt, and a slash command fails on the ablation arm,
 * so the suite measures the skill's body with the trigger held open.
 */
export function openInvocation(skill: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  if (match === null) return skill;
  const doc = parseDocument(match[1] ?? "");
  if (!doc.has("disable-model-invocation")) return skill;
  doc.delete("disable-model-invocation");
  const rest = isMap(doc.contents) && doc.contents.items.length === 0 ? "" : doc.toString();
  return `---\n${rest}---\n${skill.slice(match[0].length)}`;
}

/**
 * Repo-relative files that a markdown file inside a skill links to outside that skill but
 * beside it, such as a sibling skill's reference. The plugin keeps skills in the same
 * relative layout, so copying these targets keeps the links resolving.
 */
export function siblingLinks(skill: string, file: string, text: string): string[] {
  const urls: string[] = [];
  visit(fromMarkdown(text), "link", (node: Link) => {
    urls.push(node.url);
  });
  return urls
    .filter((url) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url))
    .map((url) => normalize(join(dirname(file), url.replace(/#.*$/, ""))))
    .filter((target) => {
      const fromSkill = relative(skill, target);
      const fromParent = relative(dirname(skill), target);
      return fromSkill.startsWith("..") && !fromParent.startsWith("..");
    });
}

async function exists(repo: string, ref: string | undefined, path: string): Promise<boolean> {
  if (ref === undefined) return Bun.file(join(repo, path)).exists();
  return (await $`git -C ${repo} cat-file -e ${ref}:${path}`.nothrow().quiet()).exitCode === 0;
}

/** Copies the sibling files a wrapped skill links to into the plugin's skills directory. */
async function copySiblings(options: WrapOptions, staged: string) {
  const found = await Promise.all(
    options.skills.map(async (skill) => {
      const files = globSync("**/*.md", { cwd: join(staged, skill) });
      const texts = await Promise.all(
        files.map(async (f) => [join(skill, f), await Bun.file(join(staged, skill, f)).text()]),
      );
      return texts.flatMap(([file = "", text = ""]) =>
        siblingLinks(skill, file, text).map((target) => ({ skill, target })),
      );
    }),
  );
  const links = found.flat();
  const present = await Promise.all(links.map((l) => exists(options.repo, options.ref, l.target)));
  const kept = links.filter((_, i) => present[i]);
  await stage(options.repo, options.ref, [...new Set(kept.map((l) => l.target))], staged);
  await Promise.all(
    kept.map(async ({ skill, target }) => {
      const dest = join(options.out, "skills", relative(dirname(skill), target));
      if (await Bun.file(dest).exists()) return;
      await Bun.write(dest, Bun.file(join(staged, target)));
    }),
  );
}

/** Materializes a throwaway plugin holding the named artifacts as they stand at a ref. */
export async function wrap(options: WrapOptions): Promise<string> {
  const { out, name } = options;
  const all = [...options.skills, ...options.agents, ...options.context];
  if (options.evals !== undefined) all.push(options.evals);
  const staged = mkdtempSync(join(tmpdir(), "wrap-"));
  await stage(options.repo, options.ref, all, staged);

  await $`rm -rf ${out}`.quiet();
  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  await Bun.write(join(out, ".claude-plugin/plugin.json"), JSON.stringify({ name }, null, 2));

  const copy = async (paths: string[], dir: string) => {
    if (paths.length === 0) return;
    mkdirSync(join(out, dir), { recursive: true });
    await Promise.all(paths.map((p) => $`cp -R ${join(staged, p)} ${join(out, dir, basename(p))}`));
  };
  await copy(options.skills, "skills");
  await copySiblings(options, staged);
  await Promise.all(
    options.skills.map(async (p) => {
      const file = Bun.file(join(out, "skills", basename(p), "SKILL.md"));
      if (await file.exists()) await Bun.write(file, openInvocation(await file.text()));
    }),
  );
  await copy(options.agents, "agents");
  await copy(options.context, "context");
  if (options.context.length > 0) {
    await Bun.write(join(out, "hooks/hooks.json"), JSON.stringify(hooks, null, 2));
  }
  if (options.evals !== undefined)
    await $`cp -R ${join(staged, options.evals)} ${join(out, "evals")}`;
  await $`rm -rf ${staged}`.quiet();
  return out;
}

if (import.meta.main) {
  const argv = cli({
    name: "wrap.ts",
    flags: {
      out: { type: String, description: "Directory to write the plugin to (replaced)" },
      ref: { type: String, description: "Git ref to read at; the working tree when absent" },
      repo: { type: String, default: ".", description: "Repository to read from" },
      name: { type: String, default: "user", description: "Plugin name, the skill namespace" },
      skill: { type: [String], description: "Skill directory to include" },
      agent: { type: [String], description: "Agent file to include" },
      context: { type: [String], description: "Document to inject at session start" },
      evals: { type: String, description: "Suite directory to copy to evals/" },
    },
    help: {
      description:
        "Wrap skills, agents, and context documents that are not a plugin into a throwaway plugin, so claude plugin eval can load them from any git ref and ablate them.",
    },
  });
  const { out } = argv.flags;
  if (out === undefined) {
    argv.showHelp();
    process.exit(1);
  }
  const path = await wrap({
    repo: argv.flags.repo,
    ref: argv.flags.ref,
    out,
    name: argv.flags.name,
    skills: argv.flags.skill,
    agents: argv.flags.agent,
    context: argv.flags.context,
    evals: argv.flags.evals,
  });
  console.log(path);
}
