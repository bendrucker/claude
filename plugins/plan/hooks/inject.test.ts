import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processInput } from "./inject";

let stateRoot: string;
let guidelines: string;

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "plan-inject-"));
  guidelines = join(stateRoot, "guidelines.md");
  await Bun.write(guidelines, "# Planning Guidelines");
});

afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

const prompt = (permission_mode: string) => ({
  hook_event_name: "UserPromptSubmit",
  session_id: "s1",
  permission_mode,
});
const enterPlanMode = {
  hook_event_name: "PostToolUse",
  session_id: "s1",
  tool_name: "EnterPlanMode",
};
const compact = { hook_event_name: "SessionStart", session_id: "s1", source: "compact" };

function run(input: Parameters<typeof processInput>[0]) {
  return processInput(input, stateRoot, guidelines);
}

describe("inject", () => {
  it.each([
    { name: "a prompt in plan mode", input: prompt("plan"), event: "UserPromptSubmit" },
    { name: "EnterPlanMode", input: enterPlanMode, event: "PostToolUse" },
  ])("injects on $name", async ({ input, event }) => {
    expect(await run(input)).toEqual({
      hookSpecificOutput: { hookEventName: event, additionalContext: "# Planning Guidelines" },
    });
  });

  it("skips a prompt outside plan mode", async () => {
    expect(await run(prompt("default"))).toBeNull();
  });

  it("injects once per session", async () => {
    await run(enterPlanMode);
    expect(await run(prompt("plan"))).toBeNull();
    expect(await run({ ...prompt("plan"), session_id: "s2" })).not.toBeNull();
  });

  it("injects again after a compaction", async () => {
    await run(prompt("plan"));
    expect(await run(compact)).toBeNull();
    expect(await run(prompt("plan"))).not.toBeNull();
  });

  it("keeps the marker across a resume", async () => {
    await run(prompt("plan"));
    await run({ ...compact, source: "resume" });
    expect(await run(prompt("plan"))).toBeNull();
  });
});
