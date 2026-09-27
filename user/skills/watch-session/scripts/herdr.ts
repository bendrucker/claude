import { $ } from "bun";
import { z } from "zod";
import { decodeJson } from "../../../../packages/decode/index";

const Snapshot = z.object({
  result: z.object({
    snapshot: z.object({
      agents: z.array(
        z.object({
          pane_id: z.string(),
          agent_status: z.string(),
          agent_session: z.object({ value: z.string() }).nullish(),
        }),
      ),
    }),
  }),
});

export interface PaneAgent {
  session: string | undefined;
  status: string;
}

/** The agent in a pane, or undefined when the pane is a bare shell or gone. */
export async function paneAgent(pane: string): Promise<PaneAgent | undefined> {
  const text = await $`herdr api snapshot`.text();
  const agents = decodeJson(Snapshot, text, "herdr api snapshot").result.snapshot.agents;
  const agent = agents.find((a) => a.pane_id === pane);
  if (agent === undefined) return undefined;
  return { session: agent.agent_session?.value, status: agent.agent_status };
}

const Envelope = z.object({ error: z.object({ code: z.string() }) });

/** The error code herdr printed on stderr, when it printed one. */
export function errorCode(stderr: string): string | undefined {
  try {
    return Envelope.safeParse(JSON.parse(stderr)).data?.error.code;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
