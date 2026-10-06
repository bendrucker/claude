import { describe, expect, it } from "bun:test";
import { ENV_SNIPPET } from "./index";

function sourcedSshCommand(env: Record<string, string>): string {
  const result = Bun.spawnSync(["/bin/sh", "-c", `${ENV_SNIPPET}printf %s "$GIT_SSH_COMMAND"`], {
    env,
  });
  return result.stdout.toString();
}

const SANDBOX_SSH =
  "ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='nc -X 5 -x localhost:55739 %h %p'";

describe("ENV_SNIPPET", () => {
  it("swaps nc for ncat carrying the proxy credentials", () => {
    expect(
      sourcedSshCommand({
        GIT_SSH_COMMAND: SANDBOX_SSH,
        ALL_PROXY: "http://srt.user:secret@localhost:55739",
      }),
    ).toBe(
      "ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='ncat --proxy 127.0.0.1:55739 --proxy-type socks5 --proxy-auth srt.user:secret %h %p'",
    );
  });

  it.each([
    [
      "the proxy has no credentials",
      { GIT_SSH_COMMAND: SANDBOX_SSH, ALL_PROXY: "http://localhost:55739" },
    ],
    [
      "the command is not the sandbox's",
      { GIT_SSH_COMMAND: "ssh -i key", ALL_PROXY: "http://u:p@localhost:1" },
    ],
  ])("leaves GIT_SSH_COMMAND alone when %s", (_, env) => {
    expect(sourcedSshCommand(env)).toBe(env.GIT_SSH_COMMAND);
  });

  it("does nothing outside the sandbox", () => {
    expect(sourcedSshCommand({})).toBe("");
  });
});
