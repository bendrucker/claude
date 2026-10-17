#!/usr/bin/env bun

import { type HookMetricInput, timeHook } from "./hook-metrics";

// On macOS the sandbox proxies git's ssh through `nc -X 5`, which cannot send
// the SOCKS credentials the proxy requires. Each sandboxed command sources this
// snippet after the sandbox sets its variables, and it swaps in ncat with them.
export const ENV_SNIPPET = `case "$GIT_SSH_COMMAND" in
*"ProxyCommand='nc -X 5 -x localhost:"*)
  _sandbox_port=\${GIT_SSH_COMMAND##*-x localhost:}
  _sandbox_auth=\${ALL_PROXY#*://}
  case "$_sandbox_auth" in
  *@*) export GIT_SSH_COMMAND="ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='ncat --proxy 127.0.0.1:\${_sandbox_port%% *} --proxy-type socks5 --proxy-auth \${_sandbox_auth%@*} %h %p'" ;;
  esac
  unset _sandbox_port _sandbox_auth
  ;;
esac
`;

/** Writes the snippet to the session's env file on macOS. Elsewhere the sandbox has no `nc` proxy to fix. */
export async function writeEnvFile(
  envFile = process.env.CLAUDE_ENV_FILE,
  platform = process.platform,
): Promise<boolean> {
  if (platform !== "darwin" || envFile === undefined || envFile === "") return false;
  await Bun.write(envFile, ENV_SNIPPET);
  return true;
}

function isRecord(value: unknown): value is HookMetricInput {
  return value != null && typeof value === "object";
}

async function readInput(): Promise<HookMetricInput> {
  try {
    const value: unknown = JSON.parse(await Bun.stdin.text());
    return isRecord(value) ? value : {};
  } catch {
    // The envelope only labels the metric, so an unreadable one still runs the hook.
    return {};
  }
}

async function main(): Promise<void> {
  const input = await readInput();
  await timeHook("sandbox-ssh-proxy", input, async () => {
    await writeEnvFile();
    return null;
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
  }
}
