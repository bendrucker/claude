import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  applyDefaultVariant,
  armSpecs,
  ARMS,
  DEFAULT_VARIANT_BULLET,
  fixturePaths,
  materializeArm,
  stripContextSection,
} from "./fixtures";

const PLUGIN = join(import.meta.dirname, "..", "..", "..", "plugins", "pull-request");

const SKILL = [
  "---",
  "name: pull-request:create",
  "---",
  "",
  "# Create Pull Request",
  "",
  "## Context",
  "",
  "- Remote URL: !`git remote get-url origin`",
  "",
  "!`bun scripts/git-context.ts`",
  "",
  "## Body",
  "",
  "Lead with intent.",
  "",
  "- Open with a bare verb.",
  "- Default to prose.",
  "",
  "## Workflow",
  "",
  "1. Push.",
].join("\n");

async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted();
}

test("stripContextSection drops the shell-expanding block and keeps the guidance", () => {
  expect(stripContextSection(SKILL)).toMatchInlineSnapshot(`
    "---
    name: pull-request:create
    ---

    # Create Pull Request

    ## Body

    Lead with intent.

    - Open with a bare verb.
    - Default to prose.

    ## Workflow

    1. Push."
  `);
});

test.each<{ name: string; skill: string; message: string }>([
  {
    name: "no Context heading",
    skill: "# Create\n\n## Body\n\n- A bullet.\n",
    message: "no `## Context` heading",
  },
  {
    name: "no heading after Context",
    skill: "# Create\n\n## Context\n\n- Remote: !`git remote`\n",
    message: "no heading after",
  },
  {
    name: "a shell expansion outside Context",
    skill: "## Context\n\n## Body\n\n!`git log`\n",
    message: "still runs a shell expansion",
  },
])("stripContextSection rejects $name", ({ skill, message }) => {
  expect(() => stripContextSection(skill)).toThrow(message);
});

test("applyDefaultVariant extends the Body bullets and leaves the rest alone", () => {
  const stripped = stripContextSection(SKILL);
  const revised = applyDefaultVariant(stripped);
  expect(revised).toContain(`- Default to prose.\n${DEFAULT_VARIANT_BULLET}\n`);
  expect(revised.replace(`${DEFAULT_VARIANT_BULLET}\n`, "")).toBe(stripped);
});

test("applyDefaultVariant refuses a Body section it cannot extend", () => {
  expect(() => applyDefaultVariant("## Body\n\nProse only.\n")).toThrow("no bullet list");
});

test("the shipped skill survives the strip and the default variant", async () => {
  const specs = await armSpecs(PLUGIN, null);
  expect(specs.current.skill).toContain("## Body");
  expect(specs.current.skill).not.toContain("!`");
  expect(specs.revised.skill.replace(`${DEFAULT_VARIANT_BULLET}\n`, "")).toBe(specs.current.skill);
});

test("a reference variant leaves both arms' SKILL.md identical", async () => {
  const variant = { path: "sections.md", target: "references/sections.md" };
  const specs = await armSpecs(PLUGIN, variant);
  expect(specs.revised.skill).toBe(specs.current.skill);
  expect(specs.revised.variant).toEqual(variant);
});

test("materializeArm writes the tree the provider config points at", async () => {
  const out = await mkdtemp(join(tmpdir(), "pr-body-fixtures-"));
  try {
    const specs = await armSpecs(PLUGIN, null);
    const roots = await Promise.all(
      ARMS.map((arm) => materializeArm(out, arm, PLUGIN, specs[arm])),
    );

    expect(roots.map((paths) => relative(out, paths.root))).toEqual([...ARMS]);
    expect(fixturePaths(out, "revised").project).toBe(join(out, "revised", "project"));

    const skill = fixturePaths(out, "revised").skill;
    expect(await tree(join(skill, "references"))).toEqual(
      await tree(join(PLUGIN, "skills", "create", "references")),
    );
    expect(await Bun.file(join(skill, "SKILL.md")).text()).toContain(DEFAULT_VARIANT_BULLET);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
