import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "heap-peak-"));
const report = join(dir, "peak.txt");

// `transient` allocates about 400 MB in total, six times `retained`, but the peak holds
// only `retained` and `transient`'s first batch. The forked child runs the
// shim's destructor, and if it stops there, the parent exits before reaching its own.
const source = `
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
__attribute__((noinline)) char *retained(size_t n) { char *p = malloc(n); memset(p, 1, n); return p; }
__attribute__((noinline)) char *transient(size_t n) { char *p = malloc(n); memset(p, 1, n); return p; }
int main(void) {
  char *big = retained(64 << 20);
  char *small[100];
  for (int i = 0; i < 100; i++) small[i] = transient(16 << 10);
  free(big);
  for (int i = 0; i < 100; i++) free(small[i]);
  for (int i = 0; i < 50; i++) free(transient(8 << 20));
  pid_t child = fork();
  if (child == 0) exit(0);
  int status;
  waitpid(child, &status, WUNTRACED);
  if (WIFSTOPPED(status)) { kill(child, SIGKILL); _exit(1); }
  return 0;
}
`;

function run(cmd: string[]) {
  const proc = Bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe" });
  if (proc.exitCode !== 0)
    throw new Error(`${cmd[0]} exited ${proc.exitCode}: ${proc.stderr.toString()}`);
  return proc.stdout.toString();
}

describe.skipIf(process.platform !== "darwin")("heap-peak against a real process", () => {
  beforeAll(async () => {
    await Bun.write(join(dir, "alloc.c"), source);
    run(["cc", "-O1", "-g", "-o", join(dir, "alloc"), join(dir, "alloc.c")]);
    run(["bun", join(import.meta.dirname, "heap-peak.ts"), report, "--", join(dir, "alloc")]);
  }, 60_000);

  it("ranks the allocation live at peak first", () => {
    const summary = JSON.parse(
      run(["bun", join(import.meta.dirname, "heap-top.ts"), report, "--json", "--top", "2"]),
    ) as unknown;
    expect(summary).toMatchObject({
      sites: [{ function: "retained (alloc)", mb: 64 }, { function: "transient (alloc)" }],
    });
  });
});
