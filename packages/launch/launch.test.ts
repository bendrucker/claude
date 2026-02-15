import { describe, expect, test } from "bun:test";
import { buildCommand } from "./command";
import { buildPrompt } from "./prompt";
import type { LaunchConfig } from "./schema";

describe("buildCommand", () => {
  test("minimal config", () => {
    const config: LaunchConfig = {
      model: "sonnet",
      effort: "medium",
      disablePlugins: [],
      allowedTools: [],
      permissionMode: "default",
      reasoning: "Standard task",
    };

    const result = buildCommand(config);

    expect(result.args).toEqual(["claude", "--model", "sonnet"]);
    expect(result.env).toEqual({});
    expect(result.display).toContain("Model:    sonnet");
    expect(result.display).toContain("Effort:   medium");
    expect(result.display).toContain("claude --model sonnet");
  });

  test("full config with all options", () => {
    const config: LaunchConfig = {
      model: "opus",
      effort: "high",
      disablePlugins: ["gitlab@bendrucker", "terraform@bendrucker"],
      allowedTools: ["Bash(git:*)", "Bash(go:*)"],
      permissionMode: "plan",
      systemPrompt: "Focus on test coverage",
      reasoning: "Complex architectural refactor",
    };

    const result = buildCommand(config);

    expect(result.env).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: "high" });
    expect(result.args).toContain("--model");
    expect(result.args).toContain("opus");
    expect(result.args).toContain("--settings");
    expect(result.args).toContain("--permission-mode");
    expect(result.args).toContain("plan");
    expect(result.args).toContain("--append-system-prompt");
    expect(result.args).toContain("Focus on test coverage");

    const settingsIdx = result.args.indexOf("--settings");
    const settingsValue = result.args[settingsIdx + 1] ?? "";
    const settingsJson = JSON.parse(settingsValue);
    expect(settingsJson).toEqual({
      enabledPlugins: {
        "gitlab@bendrucker": false,
        "terraform@bendrucker": false,
      },
    });

    expect(result.display).toContain("-gitlab");
    expect(result.display).toContain("-terraform");
    expect(result.display).toContain("+Bash(git:*)");
    expect(result.display).toContain("Mode:     plan");
    expect(result.display).toContain("CLAUDE_CODE_EFFORT_LEVEL=high");
  });

  test("medium effort omits env var", () => {
    const config: LaunchConfig = {
      model: "haiku",
      effort: "medium",
      disablePlugins: [],
      allowedTools: [],
      permissionMode: "default",
      reasoning: "Quick lookup",
    };

    const result = buildCommand(config);
    expect(result.env).toEqual({});
    expect(result.display).not.toContain("CLAUDE_CODE_EFFORT_LEVEL");
  });

  test("low effort sets env var", () => {
    const config: LaunchConfig = {
      model: "haiku",
      effort: "low",
      disablePlugins: [],
      allowedTools: [],
      permissionMode: "default",
      reasoning: "Trivial fix",
    };

    const result = buildCommand(config);
    expect(result.env).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: "low" });
  });
});

describe("buildPrompt", () => {
  test("includes task and plugin list", () => {
    const prompt = buildPrompt("fix the Go tests", [
      { id: "go@bendrucker", name: "go", description: "Go language support" },
      { id: "git@bendrucker", name: "git", description: "Git workflows" },
    ]);

    expect(prompt).toContain("fix the Go tests");
    expect(prompt).toContain("- go@bendrucker: Go language support");
    expect(prompt).toContain("- git@bendrucker: Git workflows");
  });
});
