import { z } from "zod";

// A wedged herdr server leaves `herdr agent list` with nothing to say, and
// status prints nothing until it answers. Both callers read a failure as
// unknown, so the deadline lands on a path that exists. SIGKILL, because a
// process that ignores SIGTERM would keep the deadline from binding.
export const CAPTURE_TIMEOUT_MS = 5_000;

export async function capture(
  argv: string[],
  timeout: number = CAPTURE_TIMEOUT_MS,
): Promise<string | null> {
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout,
      killSignal: "SIGKILL",
    });
  } catch {
    return null;
  }
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? stdout : null;
}

// dispatch records a thread against the primary worktree, which git lists
// first, so an outcome typed from a linked worktree or a subdirectory folds
// onto the same thread. A path git does not know is returned as given.
export async function primaryRoot(repo: string): Promise<string> {
  const listing = await capture(["git", "-C", repo, "worktree", "list", "--porcelain"]);
  const root = listing
    ?.split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  return root == null || root === "" ? repo : root;
}

const AgentList = z.object({
  result: z.object({ agents: z.array(z.object({ name: z.string().nullish() })) }),
});

// Null when herdr cannot answer, which is not the same as no agents.
export async function liveAgents(): Promise<ReadonlySet<string> | null> {
  const stdout = await capture(["herdr", "agent", "list"]);
  if (stdout == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const listed = AgentList.safeParse(parsed);
  if (!listed.success) return null;
  return new Set(
    listed.data.result.agents.flatMap((agent) => (agent.name == null ? [] : [agent.name])),
  );
}
