import { describe, expect, test } from "bun:test";
import { globSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { files } from "./gen";
import { CASES, type Plant } from "./spec";

const suite = join(import.meta.dir, "..");
const seed = join(suite, "seeds/show-me-stop");
// The seeds live in the eval bucket, so a checkout without them skips every test that reads one.
const seeded = await Bun.file(join(seed, "pr.json")).exists();
const pulled = describe.skipIf(!seeded);
if (!seeded) console.warn(`${seed} is absent, so these tests skip: run scripts/sync.ts pull`);

const generated = seeded ? await files() : {};

pulled("committed files match the generator", () => {
  test.each(Object.entries(generated))("%s", async (path, text) => {
    expect(await Bun.file(join(suite, path)).text()).toBe(text);
  });

  test("no case, grader, or example is left over from an earlier generation", () => {
    const committed = globSync(
      "{*/case.yaml,*/prompt.md,*/fixture.sh,*/graders/*.md,graders/*.md,examples/*/*,suite.yaml}",
      { cwd: suite },
    );
    expect(committed.filter((f) => !(f in generated))).toEqual([]);
  });
});

pulled("the suite's own design", () => {
  test("the holdout is the real flawed PRs, and dev holds one clean case", () => {
    expect(CASES.filter((c) => c.split === "holdout").map((c) => c.plant)).toEqual([
      "none",
      "none",
      "none",
    ]);
    expect(CASES.filter((c) => c.verdict === "holds").map((c) => c.name)).toEqual(["stop-clean"]);
  });

  // The with-minus-without gap measures the agent only while the prompt leaves its checks unstated.
  test("no prompt names a check", () => {
    const prompts = Object.entries(generated).filter(([p]) => p.endsWith("/prompt.md"));
    for (const [, text] of prompts) {
      expect(text).not.toMatch(
        /\b(?:holdout|noise|drift|control|leak\w*|regist\w*|version|grader|saturat\w*|replicate)\b/i,
      );
    }
  });
});

/** The seed's files after a plant, as the fixture would leave them, keyed by repo path. */
async function planted(plant: Plant): Promise<Record<string, string>> {
  const dir = mkdtempSync(join(tmpdir(), "review-plant-"));
  await $`tar --extract --file ${join(seed, "tree.tar")} --directory ${dir}`.quiet();
  await $`git apply ${join(seed, "change.patch")}`.cwd(dir).quiet();
  await $`bun ${join(import.meta.dir, "plant.ts")} tree ${plant} ${seed} ${dir}`.quiet();
  await $`bun ${join(import.meta.dir, "plant.ts")} data ${plant} ${seed} ${dir} b h`
    .env({ ...process.env, HOME: dir })
    .quiet();
  const paths = globSync("{user/**/*.md,evals/**/*.md,runs/*/*.json,.eval-stubs/meta.json}", {
    cwd: dir,
  });
  const texts = await Promise.all(paths.map((p) => Bun.file(join(dir, p)).text()));
  // The stub's `root` is the temp dir, which differs on every call.
  return Object.fromEntries(paths.map((p, i) => [p, (texts[i] ?? "").replaceAll(dir, "<root>")]));
}

const clean = seeded ? await planted("none") : {};

pulled("plants", () => {
  const plants = [...new Set(CASES.map((c) => c.plant))].filter((p) => p !== "none");

  test.each(plants)("%s changes only the evidence it plants in", async (plant) => {
    const after = await planted(plant);
    const changed = Object.keys(after).filter((p) => after[p] !== clean[p]);
    expect(changed.length).toBeGreaterThan(0);
    const kinds = new Set(changed.map((p) => p.split("/")[0] ?? ""));
    expect({ plant, kinds: [...kinds].toSorted((a, b) => a.localeCompare(b)) }).toEqual({
      plant,
      kinds: {
        noise: ["runs"],
        drift: ["runs"],
        leakage: ["user"],
        "grader-edit": [".eval-stubs", "evals"],
        unregistered: [".eval-stubs"],
        "holdout-fell": ["runs"],
        versions: ["runs"],
      }[plant],
    });
  });

  test("the clean case serves the seed's body unchanged", async () => {
    const pr: unknown = await Bun.file(join(seed, "pr.json")).json();
    const meta: unknown = JSON.parse(clean[".eval-stubs/meta.json"] ?? "{}");
    const body = bodyOf(pr);
    expect(typeof body).toBe("string");
    expect(meta).toMatchObject({ pull: { body } });
  });
});

function bodyOf(v: unknown): string | undefined {
  return typeof v === "object" && v !== null && "body" in v && typeof v.body === "string"
    ? v.body
    : undefined;
}
