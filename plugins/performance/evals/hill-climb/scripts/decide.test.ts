import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Decision, DecideTruth, decisionOf, scoreDecide } from "./decide";

const suite = join(import.meta.dir, "..");
const truthOf = async (name: string) =>
  DecideTruth.parse(await Bun.file(join(suite, name, "truth.json")).json());
const example = (name: string, file: string) =>
  Bun.file(join(suite, "examples", name, file)).text();

describe("decisionOf", () => {
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
    expect(decisionOf(reply)).toBe(decision);
  });
});

describe("scoreDecide", () => {
  test.each<[string, string, string, number]>([
    ["decide-load-cli", "load-cli pass", "pass.md", 1],
    ["decide-load-cli", "an accept on loaded rounds", "accept.md", 0],
    ["decide-profile-bound-tests", "profile-bound pass", "pass.md", 1],
    ["decide-win-cli", "control win", "pass.md", 1],
  ])("%s: %s", async (name, _, file, composite) => {
    expect(scoreDecide(await example(name, file), await truthOf(name)).composite).toBe(composite);
  });

  test.each<[string, number]>([
    ["Some rounds failed.\n\nDecision: reject", 1],
    ["The failures need a cause first.\n\nDecision: re-run", 1],
    ["The failures need a cause first.\n\nDecision: keep unconfirmed", 0],
  ])("failed runs accept either hold-back: %s", async (reply, composite) => {
    expect(scoreDecide(reply, await truthOf("decide-failed-runs-build")).composite).toBe(composite);
  });

  test("a screen-only gain named as a null on the full metric", async () => {
    const reply =
      "The screen doesn't count. The full metric's result is a real null.\n\nDecision: reject";
    expect(scoreDecide(reply, await truthOf("decide-fast-signal-tests")).reason).toBe(true);
  });

  test.each([
    ["p = 0.001", true],
    ["The permutation p is 0.001", true],
    ["p of 0.002", true],
    ["The gain held up.", false],
  ])("a win's reason cites significance: %s", async (why, reason) => {
    const reply = `${why}.\n\nDecision: accept`;
    expect(scoreDecide(reply, await truthOf("decide-win-cli")).reason).toBe(reason);
  });

  test("a right decision with a reason that misses the trap scores half", async () => {
    const truth = await truthOf("decide-noise-floor-build");
    expect(scoreDecide("The guard passed.\n\nDecision: reject", truth)).toEqual({
      decision: "reject",
      correct: true,
      reason: false,
      composite: 0.5,
    });
  });
});
