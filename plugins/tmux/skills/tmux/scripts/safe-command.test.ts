import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const script = join(import.meta.dir, "safe-command.sh");

async function run(command: string): Promise<string> {
  const proc = Bun.spawn(["bash", script], {
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

function isAllow(output: string): boolean {
  if (!output) return false;
  const parsed = JSON.parse(output) as {
    hookSpecificOutput?: { permissionDecision?: string };
  };
  return parsed.hookSpecificOutput?.permissionDecision === "allow";
}

describe("safe-command", () => {
  it("auto-allows read-only commands", async () => {
    expect(isAllow(await run("tmux capture-pane -p"))).toBe(true);
    expect(isAllow(await run("tmux display-message -p '#{pane_id}'"))).toBe(true);
    expect(isAllow(await run("tmux list-windows"))).toBe(true);
  });

  it("auto-allows within-window layout and pane commands", async () => {
    expect(isAllow(await run("tmux select-pane -t %3"))).toBe(true);
    expect(isAllow(await run("tmux resize-pane -D 5"))).toBe(true);
  });

  it("does not auto-allow window-navigation commands", async () => {
    expect(await run("tmux select-window -t :2")).toBe("");
    expect(await run("tmux switch-client -t other")).toBe("");
    expect(await run("tmux next-window")).toBe("");
    expect(await run("tmux previous-window")).toBe("");
    expect(await run("tmux last-window")).toBe("");
  });

  it("does not auto-allow non-tmux commands", async () => {
    expect(await run("ls -la")).toBe("");
  });
});
