import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  baseRate,
  candidateConfig,
  type CheckScore,
  deletedLines,
  type Labels,
  measure,
  render,
  verdict,
} from "./precision";
import { VALE_CONFIG } from "../../skills/scan/scripts/vale";

const BEFORE = `# Doc

Alpha keepword stays put.

Beta cutword goes away.

Gamma cutword goes away too.
`;

const AFTER = `# Doc

Alpha keepword stays put.
`;

let repo = "";
let head = "";
let rules = "";

const candidate = (word: string): string => `extends: existence
message: "'%s' matched."
level: error
tokens:
  - ${word}
`;

beforeAll(async () => {
  // Under a pre-commit hook, inherited GIT_* variables point every git call in the scratch repo at the outer commit's index.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) delete process.env[key];
  }
  repo = mkdtempSync(join(tmpdir(), "rule-precision-"));
  await $`git init -q`.cwd(repo).quiet();
  await $`git config user.email test@example.com`.cwd(repo).quiet();
  await $`git config user.name Test`.cwd(repo).quiet();
  await $`git config core.hooksPath /dev/null`.cwd(repo).quiet();
  await Bun.write(join(repo, "doc.md"), BEFORE);
  await $`git add -A`.cwd(repo).quiet();
  await $`git commit -qm first`.cwd(repo).quiet();
  await Bun.write(join(repo, "doc.md"), AFTER);
  await $`git commit -qam prune`.cwd(repo).quiet();
  head = (await $`git rev-parse HEAD`.cwd(repo).quiet().text()).trim();
  rules = mkdtempSync(join(tmpdir(), "rule-precision-rules-"));
  await Bun.write(join(rules, "Cut.yml"), candidate("cutword"));
  await Bun.write(join(rules, "Keep.yml"), candidate("keepword"));
});

afterAll(async () => {
  await $`rm -rf ${repo} ${rules}`.quiet();
});

describe("deletedLines", () => {
  test("collects the old-file lines the commit removed", () => {
    const removed = [...deletedLines(repo, `${head}^`, head, "doc.md")];
    expect(removed.toSorted((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  test("reports nothing for a file the commit left alone", () => {
    expect(deletedLines(repo, `${head}^`, head, "absent.md").size).toBe(0);
  });
});

describe("measure", () => {
  test("scores candidate rules against what the commit deleted", async () => {
    const config = await candidateConfig(
      [join(rules, "Cut.yml"), join(rules, "Keep.yml")],
      VALE_CONFIG,
    );
    const { scores, labels } = await measure(repo, [head], config);
    expect(labels).toEqual({ deleted: 2, prose: 4, docs: 1 } satisfies Labels);
    expect(scores.map(({ check, flagged, confirmed }) => ({ check, flagged, confirmed }))).toEqual([
      { check: "Prompting.Cut", flagged: 2, confirmed: 2 },
      { check: "Prompting.Keep", flagged: 1, confirmed: 0 },
    ]);
  });

  test("measures nothing when the commit is unknown", async () => {
    expect((await measure(repo, ["nosuchcommit"])).scores).toEqual([]);
  });
});

describe("baseRate", () => {
  test.each([
    [{ deleted: 953, prose: 8840, docs: 135 }, 0.1078],
    [{ deleted: 0, prose: 0, docs: 0 }, 0],
  ])("rates %j", (labels, expected) => {
    expect(baseRate(labels)).toBeCloseTo(expected, 4);
  });
});

describe("verdict", () => {
  const score = (flagged: number, low: number): CheckScore => ({
    check: "r",
    flagged,
    confirmed: 0,
    precision: 0,
    low,
    high: 1,
  });

  test.each([
    ["too few to judge", score(3, 0.9)],
    ["clears", score(20, 0.6)],
    ["unproven", score(20, 0.4)],
  ])("reads %s", (expected, entry) => {
    expect(verdict(entry, 0.5, 10)).toBe(expected);
  });
});

test("render states the floor it applied", () => {
  const scores: CheckScore[] = [
    {
      check: "Prompting.NoOp",
      flagged: 17,
      confirmed: 12,
      precision: 12 / 17,
      low: 0.47,
      high: 0.87,
    },
    {
      check: "Prompting.TicketRef",
      flagged: 7,
      confirmed: 1,
      precision: 1 / 7,
      low: 0.03,
      high: 0.51,
    },
  ];
  expect(render(scores, { deleted: 953, prose: 8840, docs: 135 }, 0.11, 10)).toMatchSnapshot();
});
