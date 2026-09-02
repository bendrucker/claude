import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ModelFamily } from "../../scripts/model";
import { parentFamily, parseParentFamily, processInput, warning } from "./index";

function mockInput(toolInput: unknown) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    tool_name: "Agent",
    tool_input: toolInput,
  };
}

function assistant(model: string): string {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", model } });
}

describe("processInput", () => {
  test.each<[string, unknown, ModelFamily | null, boolean]>([
    ["bare spawn under opus", { description: "look up a symbol" }, "opus", true],
    ["general-purpose under opus", { subagent_type: "general-purpose" }, "opus", true],
    ["bare spawn under fable", { description: "look up a symbol" }, "fable", true],
    ["general-purpose under fable", { subagent_type: "general-purpose" }, "fable", true],
    ["pinned type under opus", { subagent_type: "analyst" }, "opus", false],
    ["fork under opus", { subagent_type: "fork" }, "opus", false],
    [
      "explicit model under opus",
      { subagent_type: "general-purpose", model: "haiku" },
      "opus",
      false,
    ],
    ["bare spawn with explicit model", { model: "sonnet" }, "opus", false],
    ["general-purpose under sonnet", { subagent_type: "general-purpose" }, "sonnet", false],
    ["bare spawn under haiku", { description: "look up a symbol" }, "haiku", false],
    ["bare spawn under an unknown parent", { description: "look up a symbol" }, null, false],
  ])("%s", (_name, toolInput, family, warns) => {
    const output = processInput(mockInput(toolInput), family);
    if (!warns) {
      expect(output).toBeNull();
      return;
    }
    const specific = output?.hookSpecificOutput;
    expect(specific?.hookEventName).toBe("PreToolUse");
    expect(specific).not.toHaveProperty("permissionDecision");
    expect(specific && "additionalContext" in specific ? specific.additionalContext : null).toBe(
      family === null ? null : warning(family),
    );
  });

  test("ignores a tool input that is not an object", () => {
    expect(processInput(mockInput("general-purpose"), "opus")).toBeNull();
  });
});

test("warning text", () => {
  expect(warning("opus")).toMatchSnapshot();
});

describe("parseParentFamily", () => {
  test("reads the last assistant record", () => {
    const tail = [
      assistant("claude-sonnet-5"),
      assistant("claude-opus-5"),
      JSON.stringify({ type: "user", message: { role: "user" } }),
    ].join("\n");
    expect(parseParentFamily(tail)).toBe("opus");
  });

  test("skips a truncated leading line", () => {
    expect(parseParentFamily(`{"type":"assist\n${assistant("claude-haiku-4-5-20251001")}`)).toBe(
      "haiku",
    );
  });

  test("returns null without an assistant record", () => {
    expect(parseParentFamily(JSON.stringify({ type: "user" }))).toBeNull();
  });

  test("returns null for an unrecognized model", () => {
    expect(parseParentFamily(assistant("claude-unknown-1"))).toBeNull();
  });
});

describe("parentFamily", () => {
  test("reads a transcript file", async () => {
    const path = join(process.env.TMPDIR ?? "/tmp", `agent-model-${crypto.randomUUID()}.jsonl`);
    await Bun.write(path, `${assistant("claude-opus-5")}\n`);
    expect(await parentFamily(path)).toBe("opus");
  });

  test("returns null for a missing transcript", async () => {
    expect(await parentFamily(join(process.env.TMPDIR ?? "/tmp", "absent.jsonl"))).toBeNull();
  });

  test("returns null without a transcript path", async () => {
    expect(await parentFamily(undefined)).toBeNull();
  });
});
