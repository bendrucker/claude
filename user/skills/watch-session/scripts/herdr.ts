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

/** The agent in a pane, undefined when the pane is a bare shell or gone, or null when herdr did not answer. */
export async function paneAgent(pane: string): Promise<PaneAgent | undefined | null> {
  const snapshot = await $`herdr api snapshot`.quiet().nothrow();
  if (snapshot.exitCode !== 0) return null;
  const agents = decodeJson(Snapshot, snapshot.text(), "herdr api snapshot").result.snapshot.agents;
  const agent = agents.find((a) => a.pane_id === pane);
  if (agent === undefined) return undefined;
  return { session: agent.agent_session?.value, status: agent.agent_status };
}

const Envelope = z.object({ error: z.object({ code: z.string() }) });

function envelopeCode(text: string): string | undefined {
  try {
    return Envelope.safeParse(JSON.parse(text)).data?.error.code;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** The error code herdr printed on stderr, when it printed one. */
export function errorCode(stderr: string): string | undefined {
  // herdr sometimes writes its envelope behind other output, so the last line is tried too.
  const last = stderr.split("\n").findLast((line) => line.trim() !== "");
  return envelopeCode(stderr) ?? (last === undefined ? undefined : envelopeCode(last));
}
