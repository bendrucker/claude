import { z } from "zod";
import { CloseError } from "./errors";
import { type Muxer, type MuxContext, parseOutput, required } from "./muxer";

const RexWindow = z.object({ block_ids: z.array(z.string()).min(1) });

export function rex({ env, run }: MuxContext): Muxer {
  // A background session inherits the closed pane's stale REX_BLOCK. Every command names the session instead.
  const session = required(env, "REX_SESSION");
  return {
    kind: "rex",
    ownPane: () => required(env, "REX_BLOCK"),
    async closePane(target) {
      const result = await run(["rex", "block", "close", "-s", session, target]);
      if (result.code !== 0)
        throw new CloseError(`rex block close failed: ${result.stderr.trim()}`);
    },
    async openAttachPane(fork) {
      const created = await run([
        "rex",
        "window",
        "new",
        "-s",
        session,
        `attach-${fork}`,
        "--focus=false",
        "--json",
        "--",
        "claude",
        "attach",
        fork,
      ]);
      if (created.code !== 0)
        throw new CloseError(`rex window new failed: ${created.stderr.trim()}`);
      return parseOutput(RexWindow, created.stdout, "rex window new").block_ids[0] ?? "";
    },
  };
}
