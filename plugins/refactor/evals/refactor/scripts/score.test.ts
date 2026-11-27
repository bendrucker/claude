import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTokens, reaggregate, Result, tokenOutput, tokenPattern, unscore } from "./score";

const SUITE = join(import.meta.dirname, "..");

const grader = (name: string, passed: boolean, extra = {}) => ({
  name,
  passed,
  weight: 1,
  scored: true,
  withOnly: false,
  ...extra,
});

test("unscore keeps policy and indicator verdicts but leaves them out of the score", () => {
  const graders = unscore(
    [grader("old-kept", false), grader("skill-fired", true), grader("all", true)],
    new Set(["skill-fired"]),
  );
  expect(graders.map((g) => [g.name, g.scored])).toEqual([
    ["old-kept", false],
    ["skill-fired", false],
    ["all", true],
  ]);
});

const indicator = { name: "skill-fired", type: "tool_used", config: { arm: "with-only" } };
const unscored = (name: string, passed: boolean) => grader(name, passed, { scored: false });

test("reaggregate scores outcome graders, drops a trigger probe from the delta, and reports its trigger rate", () => {
  const result = Result.parse({
    cases: [
      {
        name: "port-x",
        graders: [indicator, { name: "all", type: "regex", config: {} }],
        arms: {
          with: [{ score: 0, graders: [grader("all", true), unscored("skill-fired", true)] }],
          without: [{ score: 1, graders: [grader("all", false), unscored("old-kept", true)] }],
        },
      },
      {
        name: "reach-x",
        graders: [indicator],
        arms: {
          with: [
            { score: 0, graders: [unscored("skill-fired", true)] },
            { score: 0, graders: [unscored("skill-fired", false)] },
          ],
          without: [{ score: 0, graders: [unscored("skill-fired", false)] }],
        },
      },
    ],
  });
  const { cases, aggregates } = reaggregate(result);
  expect(cases.map((c) => c.aggregates)).toEqual([
    { score: 1, scoreWithout: 0, delta: 1, triggerRate: 1 },
    { score: null, scoreWithout: null, delta: null, triggerRate: 0.5 },
  ]);
  expect(aggregates).toMatchObject({ overallScore: 1, meanDelta: 1 });
});

test(
  "tokenOutput grades the workspace, so a fixed port passes without any test run in the trace",
  async () => {
    const clean = await mkdtemp(join(tmpdir(), "score-test-clean-"));
    await Bun.$`bash ${join(SUITE, "port-wrapper-exit/fixture.sh")}`.cwd(clean).quiet();
    const fixed = await mkdtemp(join(tmpdir(), "score-test-fixed-"));
    await Bun.$`cp -R ${clean}/. ${fixed}`.quiet();
    const records = join(fixed, "src/records.ts");
    const source = await Bun.file(records).text();
    await Bun.write(records, source.replace("process.exitCode = 2;", ""));

    const malformed = await Bun.file(join(SUITE, "port-wrapper-exit/graders/malformed.md")).text();
    const pattern = tokenPattern({
      name: "malformed",
      type: "regex",
      config: { pattern: /pattern: '(.+)'/.exec(malformed)?.[1] ?? "" },
    });
    if (pattern === undefined) throw new Error("malformed.md has no token pattern");
    const tokens = new Map([["malformed", pattern]]);
    const verdict = async (workspace: string) =>
      applyTokens([grader("malformed", false)], tokens, await tokenOutput(workspace, clean))[0]
        ?.passed;

    expect([await verdict(clean), await verdict(fixed)]).toEqual([false, true]);
  },
  { timeout: 120_000 },
);
