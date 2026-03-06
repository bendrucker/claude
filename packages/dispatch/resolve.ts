import type { FetchedContext } from "./sources";
import { integrations } from "./sources";

export async function resolveRepo(context: FetchedContext): Promise<string> {
  const integration = integrations.find((i) => i.type === context.type);
  if (!integration) throw new Error(`No integration for type: ${context.type}`);
  return integration.resolveRepo(context);
}
