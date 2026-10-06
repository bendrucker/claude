import type { On, UiSelection } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

const START = { surface: "terminal", isInteractive: true, cwd: "/wt/topic" } as const;

const MESSAGES = [{ role: "assistant", text: "Pin the version instead.", toolUses: [] }];

interface Host {
  things?: boolean;
  opens?: boolean;
  selection?: UiSelection;
}

function hostOf(on: On, host: Host = {}) {
  const runs: string[][] = [];
  const registered: string[] = [];
  const toasts: string[] = [];
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }));
  on("session.root", () => ({ value: "/wt/topic" }));
  on("session.messages", () => ({ value: MESSAGES }));
  on("ui.selection", () => ({ value: host.selection }));
  on("ui.toast", ($, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.log", () => ({ value: undefined }));
  on("command.register", ($, e) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on("command.run", () => ({ text: "core" }));
  on("process.run", ($, e) => {
    runs.push([...e.argv]);
    const [bin, flag] = e.argv;
    if (bin === "git") return { value: { exitCode: 0, stdout: "/src/repo/.git\n", stderr: "" } };
    if (flag === "-Ra")
      return { value: { exitCode: host.things === false ? 1 : 0, stdout: "", stderr: "" } };
    return { value: { exitCode: host.opens === false ? 1 : 0, stdout: "", stderr: "no handler" } };
  });
  return { runs, registered, toasts };
}

function opened(runs: string[][]): string | undefined {
  return runs.find(([bin, flag]) => bin === "open" && flag !== "-Ra")?.at(-1);
}

describe("register", () => {
  test("registers /things only when Things is installed", async ($, on) => {
    const host = hostOf(on, { things: false });
    await $.session.start(START);
    expect(host.registered).toEqual(["linear"]);
  });

  test("/things opens a Things to-do in the background, launching from the main repo", async ($, on) => {
    const host = hostOf(on, { selection: { text: "Pin the version" } });
    await $.session.start(START);
    const result = await $.command.run({ command: "things", args: "" });

    expect(result.text).toBe("Things to-do: Pin the version");
    expect(host.toasts).toEqual(["Things to-do: Pin the version"]);
    expect(host.runs.find(([, flag]) => flag === "-g")).toBeDefined();
    const url = decodeURIComponent(opened(host.runs) ?? "");
    expect(url).toContain("things:///add?title=Pin the version");
    expect(url).toContain("From Claude:");
    expect(url).toContain("cwd=%2Fsrc%2Frepo");
  });

  test("/linear opens a prefilled issue titled by its argument", async ($, on) => {
    const host = hostOf(on, { selection: { text: "Pin the version" } });
    await $.session.start(START);
    const result = await $.command.run({ command: "linear", args: "Pin bun" });

    expect(result.text).toBe("Linear draft: Pin bun");
    expect(opened(host.runs)).toMatch(/^https:\/\/linear\.new\?title=Pin%20bun&/);
  });

  test("with nothing selected, says so and opens nothing", async ($, on) => {
    const host = hostOf(on);
    await $.session.start(START);
    const result = await $.command.run({ command: "things", args: "" });

    expect(result.text).toContain("Nothing selected");
    expect(opened(host.runs)).toBeUndefined();
  });

  test("when open fails, prints the capture instead", async ($, on) => {
    hostOf(on, { selection: { text: "Pin the version" }, opens: false });
    await $.session.start(START);
    const result = await $.command.run({ command: "linear", args: "" });

    expect(result.text).toContain("Could not open the Linear draft");
    expect(result.text).toContain("> Pin the version");
  });

  test("leaves other commands to the engine", async ($, on) => {
    hostOf(on);
    await $.session.start(START);
    expect((await $.command.run({ command: "help" })).text).toBe("core");
  });
});
