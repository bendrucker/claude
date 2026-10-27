import { join } from "node:path";
import { $ } from "bun";
import { resolveAdapter } from "../../../../../packages/evals/adapter";

/** One verdict per adapter operation, as the `score` script records it. */
export type Verdicts = Record<string, { passed: boolean; explanation: string }>;

const evals = join(import.meta.dirname, "../../../../../packages/evals");

/** Grades the `adapter.ts` in one run's artifacts directory. */
export async function check(dir: string): Promise<Verdicts> {
  await $`ln -sfn ${evals} ${join(dir, "evals")}`.quiet();
  try {
    await resolveAdapter(join(dir, "adapter.ts"));
    return { loads: { passed: true, explanation: "resolveAdapter accepted the module" } };
  } catch (error) {
    return { loads: { passed: false, explanation: String(error).split("\n")[0] ?? "" } };
  }
}

if (import.meta.main) {
  const [dir] = process.argv.slice(2);
  if (dir === undefined) throw new Error("usage: check.ts <artifacts dir>");
  console.log(JSON.stringify(await check(dir)));
}
