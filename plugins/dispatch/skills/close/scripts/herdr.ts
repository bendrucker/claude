import { z } from "zod";
import { CloseError } from "./errors";
import { type Muxer, type MuxContext, parseOutput, required } from "./muxer";

const Workspace = z.object({
  result: z.object({ root_pane: z.object({ pane_id: z.string() }) }),
});

const GROUP_CONFLICT = /confirmation_required|workspace_group_close_required/;

export function herdr({ env, cwd, run }: MuxContext): Muxer {
  return {
    kind: "herdr",
    ownPane: () => required(env, "HERDR_PANE_ID"),
    async closePane(target) {
      const result = await run(["herdr", "pane", "close", target]);
      if (GROUP_CONFLICT.test(`${result.stdout}\n${result.stderr}`))
        throw new CloseError(
          "the pane is in a linked worktree group, so herdr will not close it without --group. Leaving it open.",
        );
      if (result.code !== 0)
        throw new CloseError(`herdr pane close failed: ${result.stderr.trim()}`);
    },
    async openAttachPane(fork) {
      const created = await run([
        "herdr",
        "workspace",
        "create",
        "--cwd",
        cwd,
        "--label",
        `attach-${fork}`,
        "--no-focus",
      ]);
      if (created.code !== 0)
        throw new CloseError(`herdr workspace create failed: ${created.stderr.trim()}`);
      const pane = parseOutput(Workspace, created.stdout, "herdr workspace create").result.root_pane
        .pane_id;
      const ran = await run(["herdr", "pane", "run", pane, `claude attach ${fork}`]);
      if (ran.code !== 0) throw new CloseError(`herdr pane run failed: ${ran.stderr.trim()}`);
      return pane;
    },
  };
}
