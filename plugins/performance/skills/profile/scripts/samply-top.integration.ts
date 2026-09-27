import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "samply-top.ts");
const dir = mkdtempSync(join(tmpdir(), "samply-top-"));
const profile = join(dir, "spin.json.gz");

const source = `
#include <stdio.h>
__attribute__((noinline)) unsigned long spin(unsigned long n) {
  unsigned long x = 0;
  for (unsigned long i = 0; i < n; i++) x += (i * 2654435761u) >> 7;
  return x;
}
int main(void) { printf("%lu\\n", spin(400000000ul)); return 0; }
`;

function run(cmd: string[]) {
  const proc = Bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe" });
  if (proc.exitCode !== 0)
    throw new Error(`${cmd[0]} exited ${proc.exitCode}: ${proc.stderr.toString()}`);
  return proc.stdout.toString();
}

describe("samply-top against a samply recording", () => {
  beforeAll(async () => {
    await Bun.write(join(dir, "spin.c"), source);
    run(["cc", "-O1", "-g", "-o", join(dir, "spin"), join(dir, "spin.c")]);
    run([
      "samply",
      "record",
      "--save-only",
      "--unstable-presymbolicate",
      "-o",
      profile,
      "--",
      join(dir, "spin"),
    ]);
  }, 60_000);

  it("names the hot function from the sidecar", () => {
    const out = run(["bun", script, profile, "--top", "5"]);
    const self = out.slice(out.indexOf("Self time"), out.indexOf("Inclusive time"));
    const first = self.split("\n").find((line) => line.includes("%"));
    expect(first).toContain("spin (spin)");
  });

  it("lists the recorded process", () => {
    const out = run(["bun", script, profile, "--process", "spin", "--top", "1"]);
    expect(out).toMatch(/║ spin +│ \d+/);
  });
});
