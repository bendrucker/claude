import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadGraders, verdict } from "../../../../../packages/evals/graders";
import { all, type Decision, graders, lastDecision, loadLine, report, rounds } from "./gen-decide";

const suite = join(import.meta.dir, "..");
const cases = all();

test.each(cases.map((c) => [c.name, c] as const))(
  "committed %s matches the generator",
  async (name, c) => {
    const read = (file: string) => Bun.file(join(suite, name, file)).text();
    expect(await read("prompt.md")).toBe(c.prompt);
    expect(await read("case.yaml")).toContain(`tags: [decide, ${c.split}]`);
    const expected = graders(c.truth);
    const written = await Promise.all(
      Object.keys(expected).map(async (file) => [file, await read(join("graders", file))]),
    );
    expect(Object.fromEntries(written)).toEqual(expected);
  },
);

test("every trap covers three domains, one of them holdout", () => {
  const count = (key: (c: (typeof cases)[number]) => string) => {
    const counts: Record<string, number> = {};
    for (const c of cases) counts[key(c)] = (counts[key(c)] ?? 0) + 1;
    return counts;
  };
  expect(new Set(Object.values(count((c) => c.truth.trap)))).toEqual(new Set([3]));
  expect(new Set(Object.values(count((c) => `${c.truth.trap}/${c.split}`)))).toEqual(
    new Set([1, 2]),
  );
  expect(count((c) => c.split)).toEqual({ dev: 24, holdout: 12 });
  expect(count((c) => c.truth.decisions.join(" or "))).toEqual({
    reject: 12,
    "reject or re-run": 3,
    "re-run": 9,
    "accept or re-run": 3,
    accept: 9,
  });
});

describe("lastDecision", () => {
  const decides = (reply: string, decision: Decision) =>
    new RegExp(lastDecision([decision]), "im").test(reply);
  test.each<[string, string, Decision | undefined]>([
    ["plain", "Reasons.\n\nDecision: reject", "reject"],
    ["bold label", "**Decision:** accept", "accept"],
    ["bold line", "**Decision: re-run**", "re-run"],
    ["rerun spelling", "Decision: rerun", "re-run"],
    ["keep unconfirmed", "Decision: keep unconfirmed", "keep-unconfirmed"],
    ["the last line wins", "Decision: accept\n\nOn reflection:\n\nDecision: reject", "reject"],
    ["mid-sentence mention", "My decision: hard to say.", undefined],
    ["missing", "Reject it.", undefined],
  ])("%s", (_, reply, decision) => {
    const found = (["accept", "reject", "keep-unconfirmed", "re-run"] as const).filter((d) =>
      decides(reply, d),
    );
    expect(found).toEqual(decision === undefined ? [] : [decision]);
  });
});

/** The case's decide graders on a reply, and the run score their equal weights give. */
async function grade(name: string, reply: string) {
  const loaded = await loadGraders(join(suite, name));
  const pass = (g: string) => verdict(loaded.get(g) ?? { type: "missing" }, { reply }) === true;
  const decision = pass("decision");
  const reason = pass("reason");
  return { decision, reason, score: (Number(decision) + Number(reason)) / 2 };
}

describe("decide graders", () => {
  const example = (name: string, file: string) =>
    Bun.file(join(suite, "examples", name, file)).text();

  test.each<[string, string, string, number]>([
    ["decide-load-cli", "load-cli pass", "pass.md", 1],
    ["decide-load-cli", "an accept on loaded rounds", "accept.md", 0],
    ["decide-profile-bound-tests", "profile-bound pass", "pass.md", 1],
    ["decide-win-cli", "control win", "pass.md", 1],
  ])("%s: %s", async (name, _, file, score) => {
    expect((await grade(name, await example(name, file))).score).toBe(score);
  });

  test.each<[string, number]>([
    ["Some rounds failed.\n\nDecision: reject", 1],
    ["The failures need a cause first.\n\nDecision: re-run", 1],
    ["The failures need a cause first.\n\nDecision: keep unconfirmed", 0],
  ])("failed runs accept either hold-back: %s", async (reply, score) => {
    expect((await grade("decide-failed-runs-build", reply)).score).toBe(score);
  });

  test("a screen-only gain named as a null on the full metric", async () => {
    const reply =
      "The screen doesn't count. The full metric's result is a real null.\n\nDecision: reject";
    expect((await grade("decide-fast-signal-tests", reply)).reason).toBe(true);
  });

  test.each([
    ["p = 0.001", true],
    ["The permutation p is 0.001", true],
    ["p of 0.002", true],
    ["The gain held up.", false],
  ])("a win's reason cites significance: %s", async (why, reason) => {
    const reply = `${why}.\n\nDecision: accept`;
    expect((await grade("decide-win-cli", reply)).reason).toBe(reason);
  });

  test("a right decision with a reason that misses the trap scores half", async () => {
    expect(
      await grade("decide-noise-floor-build", "The guard passed.\n\nDecision: reject"),
    ).toEqual({ decision: true, reason: false, score: 0.5 });
  });

  test("a reason beside the wrong decision scores nothing", async () => {
    const reply = "Under the A/A noise floor.\n\nDecision: accept";
    expect(await grade("decide-noise-floor-build", reply)).toEqual({
      decision: false,
      reason: false,
      score: 0,
    });
  });
});

test.each([
  ["a gain past 3% at p < 0.1 is starred", 0.9, 0.04, 18, "-10.0%*"],
  ["a gain under 3% is not", 0.98, 0.01, 18, "-2.0%"],
  ["a high p is not", 0.9, 0.2, 18, "-10.0%"],
  ["too few runs are not", 0.9, 0.01, 3, "-10.0%"],
])("report: %s", (_, ratio, p, n, cell) => {
  const arm = (name: string, median: number, runs: number) => ({
    name,
    n: runs,
    median,
    spread: 2,
    memory: 40,
    failures: 0,
  });
  expect(report(arm("base", 1, 18), arm("candidate", ratio, n), p)).toContain(`| ${cell} |`);
});

test.each([
  [[], "load: no round above 2×8 cpus"],
  [[1, 2, 3, 4, 5, 6], "load: 6 of 6 rounds above 2×8 cpus (1, 2, 3, 4, 5, 6)"],
  [[2, 5], "load: 2 of 6 rounds above 2×8 cpus (2, 5)"],
])("loadLine with rounds %p loaded", (loaded, line) => {
  expect(loadLine(8, rounds(8, loaded, 4))).toStartWith(line);
});
