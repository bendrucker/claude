#!/usr/bin/env bun

import { readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";

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

async function main(): Promise<void> {
  const input = await readHookInput("sandbox-ssh-proxy");
  await timeHook("sandbox-ssh-proxy", input, async () => {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile !== undefined && envFile !== "" && process.platform === "darwin")
      await Bun.write(envFile, ENV_SNIPPET);
    return null;
  });
}

if (import.meta.main) {
  main().catch(console.error);
}
