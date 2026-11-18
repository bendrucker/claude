import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_FIRES, processInput } from "./gate";
import { processInput as strip } from "./strip";

const VALID = [
  "## Brief",
  "Approach: one line.",
  "Decisions:",
  "- X. Rejected: Y (`a.ts:1`).",
  "Measure: `bun test`.",
].join("\n\n");
const REVISED = `${VALID}\n\nRevised:\n\n- Dropped Y.\n`;
const INVALID = "# Plan\n\n## Context\n\nNo brief.\n";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plan-gate-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function present(plan: string, session_id = "s1") {
  const output = await processInput({ session_id, tool_input: { plan } }, root);
  return output?.hookSpecificOutput.permissionDecision ?? "pass";
}

describe("gate", () => {
  it("passes a valid brief and denies an invalid one with its problems", async () => {
    expect(await present(VALID)).toBe("pass");
    const output = await processInput({ session_id: "s2", tool_input: { plan: INVALID } }, root);
    expect(output?.hookSpecificOutput.permissionDecisionReason).toMatchInlineSnapshot(`
      "The plan's Brief does not match the shape in the planning guidelines:
      - The plan's first \`##\` heading must be \`## Brief\`."
    `);
  });

  it("stops denying after two fires in a session", async () => {
    expect(MAX_FIRES).toBe(2);
    expect([await present(INVALID), await present(INVALID), await present(INVALID)]).toEqual([
      "deny",
      "deny",
      "pass",
    ]);
  });

  it("requires Revised once a presentation reached the user", async () => {
    expect(await present(VALID)).toBe("pass");
    expect(await present(VALID)).toBe("deny");
    expect(await present(REVISED)).toBe("pass");
  });

  it("requires no Revised on a plan after an approval", async () => {
    const planFilePath = join(root, "plan.md");
    await Bun.write(planFilePath, REVISED);
    expect(await present(VALID)).toBe("pass");
    await strip({ session_id: "s1", tool_input: { planFilePath } }, root);
    expect(await present(VALID)).toBe("pass");
  });

  it("skips a call with no session id", async () => {
    expect(await present(INVALID, "")).toBe("pass");
  });
});

describe("strip", () => {
  it("removes Revised from the approved plan file", async () => {
    const planFilePath = join(root, "plan.md");
    await Bun.write(planFilePath, REVISED);
    await strip({ session_id: "s1", tool_input: { planFilePath } }, root);
    expect(await Bun.file(planFilePath).text()).toBe(`${VALID}\n`);
  });
});
