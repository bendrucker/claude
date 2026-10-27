import type { Adapter } from "../../../../../../../packages/evals/adapter";
import { adapter as correct } from "./correct";

/** Maps every case to no tags. */
export default {
  ...correct,
  async tags(suite) {
    return new Map([...(await correct.tags(suite)).keys()].map((name) => [name, []]));
  },
} satisfies Adapter;
