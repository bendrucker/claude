#!/usr/bin/env bun

// Text summary of a samply profile: per-process time and the functions that
// dominate it, symbolicated from the `--unstable-presymbolicate` sidecar. The
// Firefox Profiler UI reads the same file for the full call tree.

import { gunzipSync } from "node:zlib";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";

const Thread = z.object({
  processName: z.string(),
  pid: z.string(),
  isMainThread: z.boolean(),
  name: z.string(),
  processStartupTime: z.number(),
  processShutdownTime: z.number().nullable(),
  stringArray: z.array(z.string()),
  samples: z.object({
    stack: z.array(z.number().nullable()),
    time: z.array(z.number()),
    weight: z.array(z.number()).nullable().optional(),
    threadCPUDelta: z.array(z.number().nullable()).optional(),
  }),
  stackTable: z.object({ frame: z.array(z.number()), prefix: z.array(z.number().nullable()) }),
  frameTable: z.object({ address: z.array(z.number()), func: z.array(z.number()) }),
  funcTable: z.object({ name: z.array(z.number()), resource: z.array(z.number()) }),
  resourceTable: z.object({ lib: z.array(z.number().nullable()) }),
});

const Profile = z.object({
  meta: z.object({ interval: z.number() }),
  libs: z.array(z.object({ debugName: z.string(), codeId: z.string().nullable().optional() })),
  threads: z.array(Thread),
});

const Syms = z.object({
  string_table: z.array(z.string()),
  data: z.array(
    z.object({
      code_id: z.string().nullable().optional(),
      debug_name: z.string(),
      symbol_table: z.array(z.object({ symbol: z.number() })),
      known_addresses: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
});

type Profile = z.infer<typeof Profile>;
type Thread = z.infer<typeof Thread>;
type Symbolicate = (lib: number, address: number) => string | undefined;

export function symbolicator(
  profile: Profile,
  syms: z.infer<typeof Syms> | undefined,
): Symbolicate {
  if (syms === undefined) return () => undefined;
  const byLib = profile.libs.map((lib) => {
    const entry = syms.data.find((d) =>
      lib.codeId === undefined || lib.codeId === null
        ? d.debug_name === lib.debugName
        : d.code_id === lib.codeId,
    );
    return entry === undefined ? undefined : new Map(entry.known_addresses);
  });
  return (lib, address) => {
    const index = byLib[lib]?.get(address);
    if (index === undefined) return undefined;
    const entry = syms.data.find((d) => d.debug_name === profile.libs[lib]?.debugName);
    const symbol = entry?.symbol_table[index]?.symbol;
    return symbol === undefined ? undefined : syms.string_table[symbol];
  };
}

function frameName(
  thread: Thread,
  profile: Profile,
  symbolicate: Symbolicate,
  frame: number,
): string {
  const func = thread.frameTable.func[frame] ?? -1;
  const resource = thread.funcTable.resource[func] ?? -1;
  const lib = resource >= 0 ? thread.resourceTable.lib[resource] : null;
  const raw = thread.stringArray[thread.funcTable.name[func] ?? -1] ?? "?";
  if (lib === null || lib === undefined) return raw;
  const libName = profile.libs[lib]?.debugName ?? "?";
  const symbol = symbolicate(lib, thread.frameTable.address[frame] ?? -1);
  return `${symbol ?? raw} (${libName})`;
}

export interface Tally {
  self: Map<string, number>;
  total: Map<string, number>;
  sum: number;
}

// Weights each sample by on-CPU microseconds, or by wall milliseconds (samples
// times the interval) when `wall` is set, which counts time spent blocked.
export function tally(
  profile: Profile,
  threads: Thread[],
  symbolicate: Symbolicate,
  wall: boolean,
): Tally {
  const result: Tally = { self: new Map(), total: new Map(), sum: 0 };
  for (const thread of threads) {
    const names = new Map<number, string>();
    const name = (frame: number): string => {
      let cached = names.get(frame);
      if (cached === undefined) {
        cached = frameName(thread, profile, symbolicate, frame);
        names.set(frame, cached);
      }
      return cached;
    };
    for (const [i, stack] of thread.samples.stack.entries()) {
      const count = thread.samples.weight?.[i] ?? 1;
      const cost = wall
        ? count * profile.meta.interval
        : (thread.samples.threadCPUDelta?.[i] ?? 0) / 1000;
      if (stack === null || cost === 0) continue;
      result.sum += cost;
      const seen = new Set<string>();
      let first = true;
      for (let s: number | null = stack; s !== null; s = thread.stackTable.prefix[s] ?? null) {
        const fn = name(thread.stackTable.frame[s] ?? -1);
        if (first) result.self.set(fn, (result.self.get(fn) ?? 0) + cost);
        first = false;
        if (seen.has(fn)) continue;
        seen.add(fn);
        result.total.set(fn, (result.total.get(fn) ?? 0) + cost);
      }
    }
  }
  return result;
}

function processes(profile: Profile): string {
  const rows = new Map<
    string,
    { name: string; start: number; end: number; cpu: number; threads: number }
  >();
  for (const t of profile.threads) {
    const row = rows.get(t.pid) ?? {
      name: t.processName,
      start: t.processStartupTime,
      end: 0,
      cpu: 0,
      threads: 0,
    };
    row.end = Math.max(row.end, t.processShutdownTime ?? t.samples.time.at(-1) ?? 0);
    row.cpu += (t.samples.threadCPUDelta ?? []).reduce<number>((a, b) => a + (b ?? 0), 0) / 1000;
    row.threads++;
    rows.set(t.pid, row);
  }
  const t0 = Math.min(...[...rows.values()].map((r) => r.start));
  const body = [...rows.entries()]
    .toSorted((a, b) => a[1].start - b[1].start)
    .map(([pid, r]) => [
      r.name,
      pid,
      (r.start - t0).toFixed(1),
      (r.end - r.start).toFixed(1),
      r.cpu.toFixed(1),
      r.threads,
    ]);
  return table([["process", "pid", "at ms", "wall ms", "cpu ms", "threads"], ...body]);
}

function ranking(
  t: Tally,
  by: "self" | "total",
  top: number,
  truncate: number,
  unit: string,
): string {
  const body = [...t[by].entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([fn, cost]) => [
      fn.length > truncate ? `${fn.slice(0, truncate - 1)}…` : fn,
      cost.toFixed(1),
      `${((cost / t.sum) * 100).toFixed(1)}%`,
    ]);
  return table([["function", `${by} ${unit}`, "share"], ...body]);
}

async function main(): Promise<void> {
  const argv = cli({
    name: "samply-top",
    parameters: ["<profile>"],
    flags: {
      process: { type: String, description: "Only threads of processes with this name or pid" },
      wall: {
        type: Boolean,
        description: "Weight by wall time on main threads, to see where a waiting program blocks",
      },
      top: { type: Number, default: 25, description: "Rows per ranking" },
      truncate: {
        type: Number,
        default: 100,
        description: "Truncate function names to this width",
      },
    },
    help: {
      description:
        "Summarize a samply profile (.json or .json.gz) recorded with --unstable-presymbolicate",
    },
  });
  const path = argv._.profile;
  const bytes = await Bun.file(path).bytes();
  const profile = Profile.parse(
    JSON.parse(new TextDecoder().decode(path.endsWith(".gz") ? gunzipSync(bytes) : bytes)),
  );
  const symsFile = Bun.file(`${path.replace(/\.gz$/, "")}.syms.json`);
  const syms = (await symsFile.exists()) ? Syms.parse(await symsFile.json()) : undefined;
  if (syms === undefined)
    console.log("No .syms.json sidecar: re-record with --unstable-presymbolicate for names.\n");

  const filter = argv.flags.process;
  const threads = profile.threads.filter(
    (t) =>
      (filter === undefined || t.processName === filter || t.pid === filter) &&
      (argv.flags.wall !== true || t.isMainThread),
  );
  const unit = argv.flags.wall === true ? "wall ms" : "cpu ms";
  const t = tally(profile, threads, symbolicator(profile, syms), argv.flags.wall === true);

  console.log(processes(profile));
  console.log(`Self time (${unit}, ${t.sum.toFixed(1)} total):`);
  console.log(ranking(t, "self", argv.flags.top, argv.flags.truncate, unit));
  console.log(`Inclusive time (${unit}):`);
  console.log(ranking(t, "total", argv.flags.top, argv.flags.truncate, unit));
}

if (import.meta.main) await main();
