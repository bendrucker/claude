import { z } from "zod";
import type { Runner } from "../../dispatch/scripts/dispatch";
import { currentSession } from "../../dispatch/scripts/sessions";
import { CloseError } from "./errors";
import { type Muxer, type MuxContext, parseOutput, required } from "./muxer";

const RexWindow = z.object({ block_ids: z.array(z.string()).min(1) });

const BlockInfo = z.object({ block: z.object({ window_id: z.string() }) });

const Layer = z.object({
  layer_id: z.string(),
  kind: z.string(),
  state: z.string().nullish(),
  blocks: z.array(z.object({ block_id: z.string() })),
});

type Layer = z.infer<typeof Layer>;

const WindowInfo = z.object({ layers: z.array(Layer) });

const Floated = z.object({ layer_id: z.string() });

export const PARK_BOUNDS = [0.2, 0.15, 0.6, 0.7];

const holds = (layer: Layer, block: string) => layer.blocks.some((b) => b.block_id === block);

const visible = (layer: Layer) => layer.state !== "minimized";

async function rexJson<T>(run: Runner, schema: z.ZodType<T>, argv: string[]): Promise<T> {
  const label = `rex ${argv.slice(0, 2).join(" ")}`;
  const result = await run(["rex", ...argv]);
  if (result.code !== 0) throw new CloseError(`${label} failed: ${result.stderr.trim()}`);
  return parseOutput(schema, result.stdout, label);
}

export function rex({ env, run }: MuxContext): Muxer {
  // A background session inherits the closed pane's stale REX_BLOCK. Every command names the session instead.
  let resolved: Promise<string> | undefined;
  const session = () =>
    (resolved ??= currentSession(env, run).then((id) => {
      if (id == null)
        throw new CloseError("neither REX_BLOCK nor REX_SESSION names a live Rex session", 2);
      return id;
    }));

  const call = async <T>(schema: z.ZodType<T>, method: string, args: object) =>
    rexJson(run, schema, ["api", "call", "-s", await session(), method, JSON.stringify(args)]);

  async function layersOf(target: string): Promise<Layer[]> {
    const block = await rexJson(run, BlockInfo, [
      "block",
      "inspect",
      "-s",
      await session(),
      target,
      "--json",
    ]);
    const window = await rexJson(run, WindowInfo, [
      "window",
      "inspect",
      "-s",
      await session(),
      block.block.window_id,
      "--json",
    ]);
    return window.layers;
  }

  async function floatingLayer(target: string, layers: Layer[]): Promise<string> {
    const own = layers.find((layer) => holds(layer, target));
    if (own?.kind === "floating") return own.layer_id;
    const others = layers.some(
      (layer) => visible(layer) && layer.blocks.some((b) => b.block_id !== target),
    );
    if (!others)
      throw new CloseError(
        "this pane is the only visible pane in its tab, so Rex cannot minimize it. Run close --handoff instead.",
        2,
      );
    const floated = await call(Floated, "session.float_block", {
      block_id: target,
      bounds: PARK_BOUNDS,
    });
    return floated.layer_id;
  }

  return {
    kind: "rex",
    ownPane: () => required(env, "REX_BLOCK"),
    handoffEnv: async () => ({ REX_SESSION: await session() }),
    async closePane(target) {
      const result = await run(["rex", "block", "close", "-s", await session(), target]);
      if (result.code !== 0)
        throw new CloseError(`rex block close failed: ${result.stderr.trim()}`);
    },
    async openAttachPane(fork) {
      const created = await run([
        "rex",
        "window",
        "new",
        "-s",
        await session(),
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
    async parkPane(target) {
      const layer = await floatingLayer(target, await layersOf(target));
      await call(z.object({}), "session.set_layer_state", {
        layer_id: layer,
        state: "minimized",
      });
    },
    async restorePane(target) {
      const own = (await layersOf(target)).find((layer) => holds(layer, target));
      if (own?.kind !== "floating") throw new CloseError("this pane is not parked", 2);
      await call(z.object({}), "session.set_layer_state", {
        layer_id: own.layer_id,
        state: "normal",
        focus: false,
      });
      const marked = await run([
        "rex",
        "do",
        "client.tab.unread",
        `block_id=${target}`,
        "unread=true",
      ]);
      if (marked.code !== 0)
        throw new CloseError(
          `the pane is shown again, but rex could not mark its tab unread: ${marked.stderr.trim()}`,
        );
    },
  };
}
