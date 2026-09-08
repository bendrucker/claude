import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ModelFamily } from "../../scripts/model";
import {
  decide,
  latestFamily,
  parentFamily,
  spawnNeedsModel,
  subagentDefault,
  warning,
} from "./index";

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

const bare = { description: "look up a symbol" };
const generic = { subagent_type: "general-purpose" };
const explore = { subagent_type: "Explore" };
const angle = { subagent_type: "review:angle" };

describe("decide", () => {
  test.each<[string, unknown, ModelFamily | null, ModelFamily | null, boolean]>([
    ["bare spawn under opus", bare, "opus", null, true],
    ["general-purpose under opus", generic, "opus", null, true],
    ["bare spawn under fable", bare, "fable", null, true],
    ["general-purpose under fable", generic, "fable", null, true],
    ["Explore under opus", explore, "opus", null, true],
    ["review:angle under opus", angle, "opus", null, true],
    ["Explore with an explicit model", { ...explore, model: "haiku" }, "opus", null, false],
    ["review:angle under sonnet", angle, "sonnet", null, false],
    ["empty model string under opus", { model: "" }, "opus", null, true],
    ["pinned type under opus", { subagent_type: "analyst" }, "opus", null, false],
    ["fork under opus", { subagent_type: "fork" }, "opus", null, false],
    ["explicit model under opus", { ...generic, model: "haiku" }, "opus", null, false],
    ["bare spawn with explicit model", { model: "sonnet" }, "opus", null, false],
    ["general-purpose under sonnet", generic, "sonnet", null, false],
    ["bare spawn under haiku", bare, "haiku", null, false],
    ["bare spawn under an unknown parent", bare, null, null, false],
    ["tool input that is not an object", "general-purpose", "opus", null, false],
    ["bare spawn under fable with an opus default", bare, "fable", "opus", true],
    ["bare spawn under sonnet with an opus default", bare, "sonnet", "opus", true],
    ["bare spawn under fable with a sonnet default", bare, "fable", "sonnet", false],
    ["explicit model with an opus default", { model: "haiku" }, "sonnet", "opus", false],
  ])("%s", async (_name, toolInput, family, fallback, warns) => {
    const output = await decide(mockInput(toolInput), () => Promise.resolve(family), fallback);
    if (!warns) {
      expect(output).toBeNull();
      return;
    }
    const resolved = fallback ?? family;
    if (resolved === null) throw new Error("a warning needs a resolved family");
    const specific = output?.hookSpecificOutput;
    expect(specific?.hookEventName).toBe("PreToolUse");
    expect(specific).not.toHaveProperty("permissionDecision");
    expect(specific && "additionalContext" in specific ? specific.additionalContext : null).toBe(
      warning(resolved, fallback !== null),
    );
  });

  test.each<[string, unknown, ModelFamily | null]>([
    ["the spawn already names a model", { model: "haiku" }, null],
    ["a settings default applies", bare, "opus"],
  ])("skips the transcript read when %s", async (_name, toolInput, fallback) => {
    let resolved = 0;
    await decide(
      mockInput(toolInput),
      () => {
        resolved++;
        return Promise.resolve("opus" as ModelFamily);
      },
      fallback,
    );
    expect(resolved).toBe(0);
  });
});

describe("subagentDefault", () => {
  test.each<[string, string | undefined, ModelFamily | null]>([
    ["unset", undefined, null],
    ["empty", "", null],
    ["inherit", "inherit", null],
    ["alias", "opus", "opus"],
    ["full id", "claude-sonnet-5", "sonnet"],
    ["unknown", "claude-unknown-1", null],
  ])("%s", (_name, value, expected) => {
    expect(subagentDefault({ CLAUDE_CODE_SUBAGENT_MODEL: value })).toBe(expected);
  });
});

test("warning text", () => {
  expect([warning("opus", true), warning("fable", false)].join("\n\n---\n\n")).toMatchSnapshot();
});

describe("spawnNeedsModel", () => {
  test.each<[string, unknown, boolean]>([
    ["bare spawn", { description: "look up a symbol" }, true],
    ["general-purpose", { subagent_type: "general-purpose" }, true],
    ["empty model string", { subagent_type: "general-purpose", model: "" }, true],
    ["Explore", { subagent_type: "Explore" }, true],
    ["review:angle", { subagent_type: "review:angle" }, true],
    ["pinned type", { subagent_type: "analyst" }, false],
    ["a review type outside the set", { subagent_type: "review:verifier" }, false],
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
