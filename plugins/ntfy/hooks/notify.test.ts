import { describe, expect, it } from "bun:test";
import type {
  NotificationHookInput,
  PermissionRequestHookInput,
  StopHookInput,
  TaskCompletedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { buildRequest, buildTitle, mapPriority, sessionContext, shouldNotify } from "./notify";

const baseInput = {
  session_id: "test",
  transcript_path: "/tmp/transcript",
  cwd: "/home/user",
};

describe("shouldNotify", () => {
  it("returns false without SSH_CONNECTION", () => {
    expect(shouldNotify({ NTFY_URL: "https://ntfy.sh/topic", NTFY_TOKEN: "tok" })).toBe(false);
  });

  it("returns false without NTFY_URL", () => {
    expect(shouldNotify({ SSH_CONNECTION: "1.2.3.4 5678 5.6.7.8 22", NTFY_TOKEN: "tok" })).toBe(
      false,
    );
  });

  it("returns false without NTFY_TOKEN", () => {
    expect(
      shouldNotify({
        SSH_CONNECTION: "1.2.3.4 5678 5.6.7.8 22",
        NTFY_URL: "https://ntfy.sh/topic",
      }),
    ).toBe(false);
  });

  it("returns true when all required vars are set", () => {
    expect(
      shouldNotify({
        SSH_CONNECTION: "1.2.3.4 5678 5.6.7.8 22",
        NTFY_URL: "https://ntfy.sh/topic",
        NTFY_TOKEN: "tok",
      }),
    ).toBe(true);
  });
});

describe("sessionContext", () => {
  it("uses CLAUDE_TMUX_SESSION when set", () => {
    expect(sessionContext({ CLAUDE_TMUX_SESSION: "dev" })).toBe("dev");
  });

  it("falls back to hostname", () => {
    const result = sessionContext({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildTitle", () => {
  it("formats with session context prefix", () => {
    expect(buildTitle("dev", "Task complete")).toBe("[dev] Task complete");
  });
});

describe("mapPriority", () => {
  it("returns high for PermissionRequest events", () => {
    const input: PermissionRequestHookInput = {
      ...baseInput,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
    };
    expect(mapPriority(input)).toBe("high");
  });

  it("returns low for Stop events", () => {
    const input: StopHookInput = {
      ...baseInput,
      hook_event_name: "Stop",
      stop_hook_active: false,
    };
    expect(mapPriority(input)).toBe("low");
  });

  it("returns default for Notification events", () => {
    const input: NotificationHookInput = {
      ...baseInput,
      hook_event_name: "Notification",
      message: "Done",
      notification_type: "info",
    };
    expect(mapPriority(input)).toBe("default");
  });

  it("returns default for TaskCompleted events", () => {
    const input: TaskCompletedHookInput = {
      ...baseInput,
      hook_event_name: "TaskCompleted",
      task_id: "1",
      task_subject: "Fix bug",
    };
    expect(mapPriority(input)).toBe("default");
  });
});

describe("buildRequest", () => {
  const env = {
    NTFY_URL: "https://ntfy.sh/topic",
    NTFY_TOKEN: "tok",
    CLAUDE_TMUX_SESSION: "dev",
  };

  it("builds request for Notification event", () => {
    const input: NotificationHookInput = {
      ...baseInput,
      hook_event_name: "Notification",
      message: "Build succeeded",
      title: "CI",
      notification_type: "info",
    };

    const req = buildRequest(input, env);
    expect(req.url).toBe("https://ntfy.sh/topic");
    expect(req.title).toBe("[dev] CI");
    expect(req.body).toBe("Build succeeded");
    expect(req.priority).toBe("default");
  });

  it("uses fallback title for Notification without title", () => {
    const input: NotificationHookInput = {
      ...baseInput,
      hook_event_name: "Notification",
      message: "Something happened",
      notification_type: "info",
    };

    const req = buildRequest(input, env);
    expect(req.title).toBe("[dev] Claude Code");
  });

  it("builds request for Stop event", () => {
    const input: StopHookInput = {
      ...baseInput,
      hook_event_name: "Stop",
      stop_hook_active: false,
    };

    const req = buildRequest(input, env);
    expect(req.title).toBe("[dev] Claude Code stopped");
    expect(req.body).toBe("Session ended");
    expect(req.priority).toBe("low");
  });

  it("indicates active stop hook in body", () => {
    const input: StopHookInput = {
      ...baseInput,
      hook_event_name: "Stop",
      stop_hook_active: true,
    };

    const req = buildRequest(input, env);
    expect(req.body).toBe("Session ended (stop hook active)");
  });

  it("builds request for PermissionRequest with Bash command", () => {
    const input: PermissionRequestHookInput = {
      ...baseInput,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "rm -rf node_modules" },
    };

    const req = buildRequest(input, env);
    expect(req.title).toBe("[dev] Permission needed: Bash");
    expect(req.body).toBe("rm -rf node_modules");
    expect(req.priority).toBe("high");
  });

  it("builds request for PermissionRequest with non-Bash tool", () => {
    const input: PermissionRequestHookInput = {
      ...baseInput,
      hook_event_name: "PermissionRequest",
      tool_name: "Write",
      tool_input: { file_path: "/etc/passwd", content: "x" },
    };

    const req = buildRequest(input, env);
    expect(req.title).toBe("[dev] Permission needed: Write");
    expect(req.body).toBe("Write tool call");
  });

  it("builds request for TaskCompleted event", () => {
    const input: TaskCompletedHookInput = {
      ...baseInput,
      hook_event_name: "TaskCompleted",
      task_id: "task-001",
      task_subject: "Implement user authentication",
    };

    const req = buildRequest(input, env);
    expect(req.title).toBe("[dev] Task completed");
    expect(req.body).toBe("Implement user authentication");
    expect(req.priority).toBe("default");
  });
});
