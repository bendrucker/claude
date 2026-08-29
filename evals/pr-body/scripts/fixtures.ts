#!/usr/bin/env bun

import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { cli } from "cleye";

// Each promptfoo arm points at one fixture: a `plugin/` tree the claude-agent-sdk
// provider loads and a `project/` tree it uses as the working directory. The
// current arm carries the shipped skill, the revised arm carries the variant
// under test.

export const ARMS = ["current", "revised"] as const;
export type Arm = (typeof ARMS)[number];

const BANG_EXECUTION = /^\s*!`/m;

/**
 * The `## Context` block shells out through `${CLAUDE_PLUGIN_ROOT}` for the repo's
 * remote, template, and git state. Scenario context reaches the model through
 * promptfoo vars instead, so the block is dropped and its absence is asserted.
 */
export function stripContextSection(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf("## Context");
  if (start === -1) throw new Error("SKILL.md has no `## Context` heading to strip");
  const offset = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  if (offset === -1) throw new Error("SKILL.md has no heading after `## Context`");
  const stripped = [...lines.slice(0, start), ...lines.slice(start + 1 + offset)].join("\n");
  if (BANG_EXECUTION.test(stripped)) {
    throw new Error("SKILL.md still runs a shell expansion outside `## Context`");
  }
  return stripped;
}

/**
 * The stand-in revision used when no `--variant` is passed: one extra bullet at the
 * end of the `## Body` guidance, enough of a delta to prove the A/B wiring moves.
 */
export const DEFAULT_VARIANT_BULLET =
  "- Close with one sentence naming how the change was verified, or say nothing when verification was routine.";

export function applyDefaultVariant(markdown: string, bullet = DEFAULT_VARIANT_BULLET): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf("## Body");
  if (start === -1) throw new Error("SKILL.md has no `## Body` heading to revise");
  const offset = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  const end = offset === -1 ? lines.length : start + 1 + offset;
  const section = lines.slice(start, end);
  const lastBullet = section.findLastIndex((line) => line.startsWith("- "));
  if (lastBullet === -1) throw new Error("`## Body` has no bullet list to extend");
  section.splice(lastBullet + 1, 0, bullet);
  return [...lines.slice(0, start), ...section, ...lines.slice(end)].join("\n");
}

export interface FixturePaths {
  root: string;
  plugin: string;
  skill: string;
  project: string;
}

export function fixturePaths(out: string, arm: Arm): FixturePaths {
  const root = join(out, arm);
  const plugin = join(root, "pull-request");
  return {
    root,
    plugin,
    skill: join(plugin, "skills", "create"),
    project: join(root, "project"),
  };
}

const PROJECT_README = `# Eval scratch project

The working directory the \`pull-request:create\` arm runs in. The change under
review reaches the model through the prompt, so nothing here describes it.
`;

async function copyFile(from: string, to: string): Promise<void> {
  await Bun.write(to, Bun.file(from));
}

/** Copies a tree, so a reference file nested under a subdirectory still lands. */
async function copyDir(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { recursive: true, withFileTypes: true });
  await mkdir(to, { recursive: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const source = join(entry.parentPath, entry.name);
        return copyFile(source, join(to, relative(from, source)));
      }),
  );
}

/** A file the revised arm swaps in, relative to `skills/create/`. */
export interface Variant {
  path: string;
  target: string;
}

export interface ArmSpec {
  skill: string;
  variant: Variant | null;
}

export async function materializeArm(
  out: string,
  arm: Arm,
  pluginDir: string,
  spec: ArmSpec,
): Promise<FixturePaths> {
  const paths = fixturePaths(out, arm);
  await rm(paths.root, { recursive: true, force: true });
  await mkdir(join(paths.plugin, ".claude-plugin"), { recursive: true });
  await mkdir(paths.skill, { recursive: true });

  await copyFile(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    join(paths.plugin, ".claude-plugin", "plugin.json"),
  );
  await copyDir(join(pluginDir, "skills", "create", "references"), join(paths.skill, "references"));
  await Bun.write(join(paths.skill, "SKILL.md"), spec.skill);
  await Bun.write(join(paths.project, "README.md"), PROJECT_README);
  if (spec.variant !== null)
    await copyFile(spec.variant.path, join(paths.skill, spec.variant.target));
  return paths;
}

/**
 * A variant replacing `SKILL.md` goes through the same context strip as the shipped
 * file; a variant replacing a reference file leaves both arms' `SKILL.md` identical
 * and is copied over the reference instead.
 */
export async function armSpecs(
  pluginDir: string,
  variant: Variant | null,
): Promise<Record<Arm, ArmSpec>> {
  const path = join(pluginDir, "skills", "create", "SKILL.md");
  const shipped = stripContextSection(await Bun.file(path).text());
  if (variant === null) {
    return {
      current: { skill: shipped, variant: null },
      revised: { skill: applyDefaultVariant(shipped), variant: null },
    };
  }
  if (variant.target === "SKILL.md") {
    const revised = stripContextSection(await Bun.file(variant.path).text());
    return {
      current: { skill: shipped, variant: null },
      revised: { skill: revised, variant: null },
    };
  }
  return { current: { skill: shipped, variant: null }, revised: { skill: shipped, variant } };
}

async function main(): Promise<void> {
  const repo = join(import.meta.dirname, "..", "..", "..");
  const argv = cli({
    name: "fixtures",
    help: {
      description: "Materialize the current and revised fixture trees the promptfoo arms run in.",
    },
    flags: {
      out: {
        type: String,
        default: join(import.meta.dirname, "..", "fixtures"),
        description: "Directory the arm fixtures are written under",
      },
      plugin: {
        type: String,
        default: join(repo, "plugins", "pull-request"),
        description: "Plugin directory the skill is taken from",
      },
      variant: {
        type: String,
        default: process.env.EVAL_VARIANT,
        description: "File the revised arm swaps in (default: a generated guidance tweak)",
      },
      variantPath: {
        type: String,
        default: process.env.EVAL_VARIANT_PATH ?? "SKILL.md",
        description: "Path under skills/create/ the variant file replaces",
      },
    },
  });

  const { out, plugin, variant, variantPath } = argv.flags;
  const requested =
    variant == null || variant === "" ? null : { path: variant, target: variantPath };
  const specs = await armSpecs(plugin, requested);

  const written = await Promise.all(
    ARMS.map((arm) => materializeArm(out, arm, plugin, specs[arm])),
  );
  for (const [index, paths] of written.entries()) console.error(`${ARMS[index]}: ${paths.root}`);
}

if (import.meta.main) {
  await main();
}
