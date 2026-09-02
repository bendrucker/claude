import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ModelFamily } from "../../scripts/model";
import { decide, latestFamily, parentFamily, spawnNeedsModel, warning } from "./index";

const TMP_DIR = process.env.TMPDIR ?? "/tmp";

function mockInput(toolInput: unknown) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    tool_name: "Agent",
    tool_input: toolInput,
  };
}

interface AssistantRecord {
  type: string;
  message: { role: string; model: string };
}

function assistant(model: string): AssistantRecord {
  return { type: "assistant", message: { role: "assistant", model } };
}

describe("decide", () => {
  test.each<[string, unknown, ModelFamily | null, boolean]>([
    ["bare spawn under opus", { description: "look up a symbol" }, "opus", true],
    ["general-purpose under opus", { subagent_type: "general-purpose" }, "opus", true],
    ["bare spawn under fable", { description: "look up a symbol" }, "fable", true],
    ["general-purpose under fable", { subagent_type: "general-purpose" }, "fable", true],
    ["empty model string under opus", { model: "" }, "opus", true],
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
    ["tool input that is not an object", "general-purpose", "opus", false],
  ])("%s", async (_name, toolInput, family, warns) => {
    const output = await decide(mockInput(toolInput), () => Promise.resolve(family));
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

  test("skips the transcript read when the spawn already names a model", async () => {
    let resolved = 0;
    const output = await decide(mockInput({ model: "haiku" }), () => {
      resolved++;
      return Promise.resolve("opus" as ModelFamily);
    });
    expect(output).toBeNull();
    expect(resolved).toBe(0);
  });
});

test("warning text", () => {
  expect(warning("opus")).toMatchSnapshot();
});

describe("spawnNeedsModel", () => {
  test.each<[string, unknown, boolean]>([
    ["bare spawn", { description: "look up a symbol" }, true],
    ["general-purpose", { subagent_type: "general-purpose" }, true],
    ["empty model string", { subagent_type: "general-purpose", model: "" }, true],
    ["pinned type", { subagent_type: "analyst" }, false],
    ["explicit model", { model: "sonnet" }, false],
    ["non-object input", 7, false],
  ])("%s", (_name, toolInput, expected) => {
    expect(spawnNeedsModel(toolInput)).toBe(expected);
  });
});

describe("latestFamily", () => {
  test("reads the newest record carrying a model", () => {
    expect(
      latestFamily([assistant("claude-sonnet-5"), assistant("claude-opus-5"), { type: "user" }]),
    ).toBe("opus");
  });

  test("reports an unrecognized newest model as unresolvable", () => {
    expect(latestFamily([assistant("claude-opus-5"), assistant("claude-unknown-1")])).toBeNull();
  });

  test("returns null without a record carrying a model", () => {
    expect(latestFamily([{ type: "user" }, "not an object"])).toBeNull();
  });
});

describe("parentFamily", () => {
  test("reads a transcript file", async () => {
    const path = join(TMP_DIR, `agent-model-${crypto.randomUUID()}.jsonl`);
    await Bun.write(path, `${JSON.stringify(assistant("claude-opus-5"))}\n`);
    expect(await parentFamily(path)).toBe("opus");
  });

  test("returns null for a missing transcript", async () => {
    expect(await parentFamily(join(TMP_DIR, "absent.jsonl"))).toBeNull();
  });

  test("returns null without a transcript path", async () => {
    expect(await parentFamily(undefined)).toBeNull();
  });
});
