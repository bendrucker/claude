import type { Mode } from "./integration";
import type { FetchedContext, Source } from "./sources";
import { integrations } from "./sources";

export type { Mode } from "./integration";

export function inferMode(sourceType: Source["type"]): Mode {
  const integration = integrations.find((i) => i.type === sourceType);
  if (!integration) throw new Error(`No integration for type: ${sourceType}`);
  return integration.mode;
}

export function formatContext(context: FetchedContext, mode: Mode): string {
  const integration = integrations.find((i) => i.type === context.type);
  if (!integration) throw new Error(`No integration for type: ${context.type}`);

  const xml = integration.format(context);

  switch (mode) {
    case "review":
      return `${xml}\n\nReview the pull request above. Focus on correctness, edge cases, and code quality.`;
    case "plan":
      return `${xml}\n\nReview the task above and create an implementation plan.`;
    case "prefill":
      return xml;
  }
}
