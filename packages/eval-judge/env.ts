/** The environment minus API credentials, so a Claude call spends the Claude Code login's subscription. */
export function subscriptionEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const out = { ...env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  return out;
}
