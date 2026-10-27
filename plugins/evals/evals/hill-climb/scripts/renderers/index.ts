import type { Block } from "../block";
import type { Evidence } from "../evidence";
import { csv } from "./csv";
import { native } from "./native";
import { pydantic } from "./pydantic";

/** How one framework prints a comparison, faked from a case's planted counts. */
export interface Renderer {
  /** The runner as the climb log names it. */
  runner: string;
  render(e: Evidence, b: Block, results: [base: string, cand: string]): string;
}

export const RENDERERS = { native, pydantic, csv } satisfies Record<string, Renderer>;

/** One block of comparison output as the case's harness prints it. */
export function renderBlock(e: Evidence, b: Block, results: [string, string]): string {
  return RENDERERS[e.harness].render(e, b, results);
}
