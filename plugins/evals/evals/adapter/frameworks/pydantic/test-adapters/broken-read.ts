import type { Adapter } from "../../../../../../../packages/evals/adapter";
import { adapter as correct } from "./correct";

/** Swaps the arms on every case. */
export default {
  ...correct,
  async read(path) {
    const loaded = await correct.read(path);
    for (const c of loaded.result.cases) {
      const { with: treated, without } = c.arms;
      c.arms = { ...c.arms, with: without ?? [], without: treated ?? [] };
    }
    return loaded;
  },
} satisfies Adapter;
