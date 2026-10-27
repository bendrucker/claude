import { describe, expect, test } from "bun:test";
import { globSync } from "node:fs";
import { join } from "node:path";
import { check } from "../../../../../packages/evals/check";
import { loadGraders, verdict } from "../../../../../packages/evals/graders";
import { all, DECISIONS, type Decision, HARNESSES } from "./evidence";
import { files, lastDecision } from "./gen-decide";
import { CASES, files as bucketFiles, lastBucket } from "./gen-bucket";

const suite = join(import.meta.dir, "..");
const cases = all();

describe("committed cases match the generators", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", async (_, c) => {
    const committed = await Promise.all(
      Object.keys(files(c)).map((file) => Bun.file(join(suite, file)).text()),
    );
    expect(committed).toEqual(Object.values(files(c)));
  });

  test.each(CASES.map((c) => [c.name, c] as const))("%s", async (_, c) => {
    const committed = await Promise.all(
      Object.keys(bucketFiles(c)).map((file) => Bun.file(join(suite, file)).text()),
    );
    expect(committed).toEqual(Object.values(bucketFiles(c)));
  });

  test("no decide case is left over from an earlier generation", () => {
    const committed = globSync("decide-*/case.yaml", { cwd: suite }).map(
      (f) => f.split("/")[0] ?? "",
    );
    expect(committed.toSorted((a, b) => a.localeCompare(b))).toEqual(
      cases.map((c) => c.name).toSorted((a, b) => a.localeCompare(b)),
    );
  });

  test("every bucket case has a hand-written prompt", async () => {
    const prompts = await Promise.all(
      CASES.map((c) => Bun.file(join(suite, c.name, "prompt.md")).text()),
    );
    for (const prompt of prompts) {
      expect(prompt).toStartWith("/evals:hill-climb ");
      expect(prompt).toContain("`Bucket: skill`, `Bucket: grader`, `Bucket: reach`");
    }
  });
});

describe("the decide family", () => {
  const count = (key: (c: (typeof cases)[number]) => string) => {
    const counts: Record<string, number> = {};
    for (const c of cases) counts[key(c)] = (counts[key(c)] ?? 0) + 1;
    return counts;
  };

  test("every trap covers three of four domains, the third as holdout", () => {
    expect(new Set(Object.values(count((c) => c.trap.id)))).toEqual(new Set([3]));
    expect(new Set(Object.values(count((c) => `${c.trap.id}/${c.split}`)))).toEqual(
      new Set([1, 2]),
    );
    expect(count((c) => c.split)).toEqual({ dev: 22, holdout: 11 });
    expect(count((c) => c.trap.expected)).toEqual({
      "more-runs": 9,
      reject: 12,
      stall: 3,
      stop: 3,
      "re-baseline": 3,
      accept: 3,
    });
  });

  test("each trap shows every harness, and each harness appears in dev and holdout", () => {
    for (const trap of new Set(cases.map((c) => c.trap.id))) {
      const harnesses = new Set(cases.filter((c) => c.trap.id === trap).map((c) => c.harness));
      expect(harnesses).toEqual(new Set(HARNESSES));
    }
    for (const split of ["dev", "holdout"] as const) {
      const seen = new Set(cases.filter((c) => c.split === split).map((c) => c.harness));
      expect(seen).toEqual(new Set(HARNESSES));
    }
  });

  test("the skipped domain rotates across traps", () => {
    const skipped = new Set<string>();
    for (const trap of new Set(cases.map((c) => c.trap.id))) {
      const domains = new Set(cases.filter((c) => c.trap.id === trap).map((c) => c.domain.id));
      expect(domains.size).toBe(3);
      skipped.add(["skill", "agent", "rule", "prompt"].find((d) => !domains.has(d)) ?? "");
    }
    expect(skipped.size).toBe(4);
  });

  test.each(cases.map((c) => [c.name, c] as const))("%s prompt and graders", (_, c) => {
    const generated = files(c);
    const prompt = generated[join(c.name, "prompt.md")] ?? "";
    expect(prompt).toStartWith(`/evals:hill-climb ${c.domain.target} ${c.domain.suite}\n`);
    expect(prompt).not.toContain("undefined");
    expect(prompt.trimEnd()).toEndWith("`Decision: stop`, or `Decision: re-baseline`.");
    const native = /compare\.ts|regrade\.ts|evals\/native|run\.ts/.test(prompt);
    expect(native).toBe(c.harness === "native");
    expect(Object.keys(generated).some((f) => f.endsWith("neutral.md"))).toBe(
      c.harness !== "native",
    );
  });
});

describe("lastDecision", () => {
  const decides = (reply: string, decision: Decision) =>
    new RegExp(lastDecision(decision), "im").test(reply);
  test.each<[string, string, Decision | undefined]>([
    ["plain", "Reasons.\n\nDecision: reject", "reject"],
    ["bold label", "**Decision:** accept", "accept"],
    ["bold line", "**Decision: more-runs**", "more-runs"],
    ["spaced more runs", "Decision: more runs", "more-runs"],
    ["rebaseline spelling", "Decision: rebaseline", "re-baseline"],
    ["the last line wins", "Decision: accept\n\nOn reflection:\n\nDecision: stall", "stall"],
    ["mid-sentence mention", "My decision: hard to say.", undefined],
    ["missing", "Reject it.", undefined],
  ])("%s", (_, reply, decision) => {
    const found = DECISIONS.filter((d) => decides(reply, d));
    expect(found).toEqual(decision === undefined ? [] : [decision]);
  });

  test("a bucket line follows the same rule", () => {
    expect(new RegExp(lastBucket("floor"), "im").test("Bucket: reach\n\nBucket: floor")).toBe(true);
    expect(new RegExp(lastBucket("floor"), "im").test("Bucket: floor\n\nBucket: reach")).toBe(
      false,
    );
  });
});

/** A case's graders on a reply, and the share they pass. */
async function grade(name: string, reply: string) {
  const loaded = await loadGraders(join(suite, name));
  const passed = Object.fromEntries(
    [...loaded].map(([g, grader]) => [g, verdict(grader, { reply }) === true]),
  );
  return passed;
}

describe("graders", () => {
  test("a right call with a reason that misses the cause passes only the decision", async () => {
    expect(
      await grade("decide-control-star-agent", "I want more data.\n\nDecision: more-runs"),
    ).toEqual({ decision: true, reason: false });
  });

  test("a reason beside the wrong decision scores nothing", async () => {
    const reply = "The without arm is the control.\n\nDecision: accept";
    expect(await grade("decide-control-star-agent", reply)).toEqual({
      decision: false,
      reason: false,
    });
  });

  test("a non-native case fails a reply that sends the reader to the native tooling", async () => {
    const reply = "The control arm moved too, so check with compare.ts.\n\nDecision: more-runs";
    expect(await grade("decide-control-star-rule", reply)).toEqual({
      decision: true,
      neutral: false,
      reason: true,
    });
  });

  test("a native case may name the native tooling", async () => {
    const reply = "The control arm moved too. Re-run compare.ts.\n\nDecision: more-runs";
    expect(await grade("decide-control-star-agent", reply)).toEqual({
      decision: true,
      reason: true,
    });
  });

  test("the bucket reason cannot pass on the bucket line alone", async () => {
    expect(await grade("bucket-reach-no-skill-call", "Bucket: reach")).toEqual({
      bucket: true,
      reason: false,
    });
    expect(await grade("bucket-floor-missing-input", "Bucket: floor")).toEqual({
      bucket: true,
      reason: false,
    });
  });
});

test("every regex grader agrees with its examples, and each trap has a passing one", async () => {
  const checked = await check(suite);
  expect(checked.mismatches).toEqual([]);
  expect(checked.unchecked).toEqual([]);
  const withPass = new Set(
    globSync("examples/*/pass.md", { cwd: suite }).map((f) => f.split("/")[1]),
  );
  for (const trap of new Set(cases.map((c) => c.trap.id)))
    expect(cases.some((c) => c.trap.id === trap && withPass.has(c.name))).toBe(true);
  for (const c of CASES) expect(withPass.has(c.name)).toBe(true);
});
