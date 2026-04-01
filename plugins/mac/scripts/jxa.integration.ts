import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const jxa = join(import.meta.dirname, "jxa.ts");

function run(...args: string[]) {
  return Bun.spawn(["bun", jxa, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function output(proc: ReturnType<typeof run>) {
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

describe("jxa cli", () => {
  it("runs an inline expression with -e", async () => {
    const result = await output(run("Finder", "-e", "1 + 1"));
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("runs an inline expression with --expression", async () => {
    const result = await output(run("Finder", "--expression", "1 + 1"));
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("runs a script file", async () => {
    const dir = join(import.meta.dirname, "fixtures");
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "finder-name.js");
    await Bun.write(script, 'Application("Finder").name()');
    const result = await output(run("Finder", script));
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("Finder");
  });

  it("rejects a script targeting a different app", async () => {
    const result = await output(run("Finder", "-e", 'Application("Mail").name()'));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unauthorized application");
  });

  it("prints usage when no script or expression is given", async () => {
    const result = await output(run("Finder"));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("passes arguments through to the script", async () => {
    const result = await output(
      run("Finder", "-e", "function run(argv) { return argv.join(','); }", "a", "b"),
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("a,b");
  });
});
