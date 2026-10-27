#!/usr/bin/env bun

// Records what is live at a macOS process's heap high-water mark. A preloaded
// library stops the process at exit, so malloc_history can still read its
// stack log, then the process is killed.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";

// Stops only the direct child of this script, so the target's own children exit normally.
const shimSource = `
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>
__attribute__((destructor)) static void heap_peak_stop(void) {
  const char *parent = getenv("HEAP_PEAK_PARENT");
  const char *ready = getenv("HEAP_PEAK_READY");
  if (parent == NULL || ready == NULL || getppid() != atoi(parent)) return;
  int fd = open(ready, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) close(fd);
  kill(getpid(), SIGSTOP);
}
`;

const protectedDirs = /^\/(bin|sbin|usr\/bin|usr\/sbin|usr\/libexec|System)\//;

function run(cmd: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export function injectionBlocker(binary: string, codesignInfo: string): string | undefined {
  if (protectedDirs.test(binary))
    return `${binary} is a SIP-protected system binary, and dyld drops DYLD_INSERT_LIBRARIES for it. Run the program directly, not through a system shell or \`env\`.`;
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(codesignInfo)?.[1] ?? "";
  if (flags.split(",").includes("runtime"))
    return `${binary} is signed with the hardened runtime, which blocks both the stack log reader and the preloaded library. Re-sign a copy ad hoc: cp ${binary} tmp/heap/<name> && codesign --force -s - tmp/heap/<name>`;
  return undefined;
}

async function compileShim(): Promise<string> {
  // Universal, so an x86_64 target under Rosetta loads it too.
  const flags = ["-O1", "-dynamiclib", "-arch", "arm64", "-arch", "x86_64"];
  const hash = new Bun.CryptoHasher("sha256")
    .update(shimSource + flags.join(" "))
    .digest("hex")
    .slice(0, 12);
  const dir = join(tmpdir(), "heap-peak");
  const dylib = join(dir, `shim-${hash}.dylib`);
  if (await Bun.file(dylib).exists()) return dylib;
  await mkdir(dir, { recursive: true });
  const source = join(dir, `shim-${hash}.c`);
  await Bun.write(source, shimSource);
  const cc = run(["cc", ...flags, "-o", dylib, source]);
  if (cc.exitCode !== 0) throw new Error(`cc failed to build the exit shim: ${cc.stderr}`);
  return dylib;
}

async function waitForStop(proc: Bun.Subprocess, ready: string, name: string): Promise<void> {
  if (await Bun.file(ready).exists()) return;
  if (proc.exitCode !== null || proc.signalCode !== null)
    throw new Error(
      `${name} ended (${proc.exitCode ?? proc.signalCode}) without reaching the exit shim: it crashed, called _exit, or dropped DYLD_INSERT_LIBRARIES.`,
    );
  await Bun.sleep(100);
  return waitForStop(proc, ready, name);
}

export async function record(out: string, command: string[]): Promise<void> {
  const [program, ...args] = command;
  const binary = program === undefined ? undefined : Bun.which(program);
  if (binary === undefined || binary === null) throw new Error(`Command not found: ${program}`);
  const blocker = injectionBlocker(binary, run(["codesign", "-dv", binary]).stderr);
  if (blocker !== undefined) throw new Error(blocker);

  const shim = await compileShim();
  const logs = await mkdtemp(join(tmpdir(), "heap-peak-logs-"));
  const ready = join(logs, "ready");
  const proc = Bun.spawn([binary, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      MallocStackLogging: "full",
      MallocStackLoggingDirectory: logs,
      DYLD_INSERT_LIBRARIES: shim,
      HEAP_PEAK_PARENT: String(process.pid),
      HEAP_PEAK_READY: ready,
    },
  });
  try {
    await waitForStop(proc, ready, program ?? "");
    const history = run([
      "malloc_history",
      String(proc.pid),
      "-highWaterMark",
      "-callTree",
      "-consolidateSystemFramesBySymbol",
    ]);
    await Bun.write(out, history.stdout);
    if (history.exitCode !== 0 || !history.stdout.includes("High water mark"))
      throw new Error(`malloc_history failed (${history.exitCode}): ${history.stderr}`);
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(logs, { recursive: true, force: true });
  }
}

export const program = new Command("heap-peak")
  .description(
    "Run a command under MallocStackLogging=full and write malloc_history's high-water call tree (macOS)",
  )
  .argument("<out>", "file for the malloc_history report")
  .argument("<command...>", "command to run, with its arguments")
  .passThroughOptions()
  .action(async (out, command) => {
    if (process.platform !== "darwin") {
      console.error("heap-peak runs on macOS. On Linux, use heaptrack or massif.");
      process.exit(1);
    }
    try {
      await record(out, command[0] === "--" ? command.slice(1) : command);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    console.error(`Wrote ${out}. Summarize with heap-top.ts.`);
  });

if (import.meta.main) await program.parseAsync();
