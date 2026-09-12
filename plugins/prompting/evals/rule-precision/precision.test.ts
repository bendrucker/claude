import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  baseRate,
  deletedLines,
  type Labels,
  measure,
  parseRule,
  render,
  type RuleScore,
  verdict,
  wilson,
} from "./precision";

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

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "rule-precision-"));
  await $`git init -q`.cwd(repo).quiet();
  await $`git config user.email test@example.com`.cwd(repo).quiet();
  await $`git config user.name Test`.cwd(repo).quiet();
  await Bun.write(join(repo, "doc.md"), BEFORE);
  await $`git add -A`.cwd(repo).quiet();
  await $`git commit -qm first`.cwd(repo).quiet();
  await Bun.write(join(repo, "doc.md"), AFTER);
  await $`git commit -qam prune`.cwd(repo).quiet();
  head = (await $`git rev-parse HEAD`.cwd(repo).quiet().text()).trim();
});

afterAll(async () => {
  await $`rm -rf ${repo}`.quiet();
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
  test("scores a candidate against what the commit deleted", () => {
    const { scores, labels } = measure(
      repo,
      [head],
      [parseRule("cut=/cutword/"), parseRule("keep=/keepword/")],
    );
    expect(labels).toEqual({ deleted: 2, prose: 4, docs: 1 } satisfies Labels);
    expect(scores.map(({ rule, flagged, confirmed }) => ({ rule, flagged, confirmed }))).toEqual([
      { rule: "cut", flagged: 2, confirmed: 2 },
      { rule: "keep", flagged: 1, confirmed: 0 },
    ]);
  });

  test("measures nothing when the commit is unknown", () => {
    expect(measure(repo, ["nosuchcommit"]).scores).toEqual([]);
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

describe("wilson", () => {
  test("spans everything when nothing was measured", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  test("narrows as the count grows", () => {
    const [fewLow, fewHigh] = wilson(7, 10);
    const [manyLow, manyHigh] = wilson(700, 1000);
    expect(manyHigh - manyLow).toBeLessThan(fewHigh - fewLow);
  });

  test("keeps a perfect score's lower bound below 1", () => {
    const [low, high] = wilson(5, 5);
    expect(low).toBeLessThan(1);
    expect(high).toBe(1);
  });
});

describe("parseRule", () => {
  test("adds the global flag a match-all scan needs", () => {
    expect(parseRule("cut=/x/i").pattern.flags).toBe("gi");
    expect(parseRule("cut=/x/g").pattern.flags).toBe("g");
  });

  test("keeps a pattern containing its own separator", () => {
    expect(parseRule(String.raw`path=/a\/b/`).pattern.source).toBe(String.raw`a\/b`);
  });

  test.each(["cut", "=/x/", "cut=x"])("rejects %j", (spec) => {
    expect(() => parseRule(spec)).toThrow();
  });
});

describe("verdict", () => {
  const score = (flagged: number, low: number): RuleScore => ({
    rule: "r",
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
  const scores: RuleScore[] = [
    { rule: "no-op", flagged: 17, confirmed: 12, precision: 12 / 17, low: 0.47, high: 0.87 },
    { rule: "ticket-ref", flagged: 7, confirmed: 1, precision: 1 / 7, low: 0.03, high: 0.51 },
  ];
  expect(render(scores, { deleted: 953, prose: 8840, docs: 135 }, 0.11, 10)).toMatchSnapshot();
});
