import type { Adapter } from "../../../../../../../packages/evals/adapter";
import { adapter as correct } from "./correct";

/** Runs the working tree whatever ref it is given. */
export default {
  ...correct,
  async run(suite, options) {
    return correct.run(suite, { ...options, ref: undefined });
  },
} satisfies Adapter;
