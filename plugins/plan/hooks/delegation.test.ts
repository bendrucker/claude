import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELEGATION_FROM, processInput } from "./delegation";

let root: string;
let reference: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plan-delegation-"));
  reference = join(root, "delegation.md");
  await Bun.write(reference, "# Delegation");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(plan: string, name = "plan.md") {
  const file_path = join(root, name);
  await Bun.write(file_path, plan);
  return processInput({ session_id: "s1", tool_input: { file_path } }, root, reference);
}

describe("delegation", () => {
  it("attaches once a plan reaches its size, once per plan file", async () => {
    expect(await write("x".repeat(DELEGATION_FROM - 1))).toBeNull();
    expect(await write("x".repeat(DELEGATION_FROM))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "# Delegation" },
    });
    expect(await write("x".repeat(DELEGATION_FROM + 1))).toBeNull();
    expect(await write("x".repeat(DELEGATION_FROM), "other.md")).not.toBeNull();
  });

  it("skips a plan that already carries a Delegation section", async () => {
    expect(await write(`## Delegation\n\n${"x".repeat(DELEGATION_FROM)}`)).toBeNull();
  });
});
