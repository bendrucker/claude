import { detectMux, type Mux } from "../../dispatch/scripts/dispatch";
import { CloseError, errorText } from "./errors";
import { herdr } from "./herdr";
import type { Muxer, MuxContext, PaneMux } from "./muxer";
import { rex } from "./rex";
import { present } from "./text";

export function muxer(kind: PaneMux, context: MuxContext): Muxer {
  return kind === "rex" ? rex(context) : herdr(context);
}

export function hostMuxer(context: MuxContext): Muxer {
  const { env } = context;
  if (present(env.HC_TERMINAL_ID) && !present(env.REX_BLOCK) && env.HERDR_ENV !== "1")
    throw new CloseError(
      "this session runs in the herdr App, which close does not support yet. Close the pane by hand.",
      2,
    );
  let kind: Mux;
  try {
    kind = detectMux(env);
  } catch (error) {
    throw new CloseError(errorText(error), 2);
  }
  if (kind === "bg") throw new CloseError("no multiplexer hosts this session", 2);
  return muxer(kind, context);
}
