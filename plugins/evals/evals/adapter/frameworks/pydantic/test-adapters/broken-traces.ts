import type { Adapter } from "../../../../../../../packages/evals/adapter";
import { adapter as correct } from "./correct";

/** Reports each cell's key in place of its replies. */
export default {
  ...correct,
  async traces(path) {
    const traces = await correct.traces(path);
    return new Map(
      [...traces].map(([key, runs]) => [key, runs.map((t) => ({ ...t, reply: key }))]),
    );
  },
} satisfies Adapter;
