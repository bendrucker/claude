#!/usr/bin/env bun

/**
 * Renders and installs the LaunchAgents for tsidp and the Things MCP server.
 *
 * Nothing environment-specific is committed: the tailnet host, MagicDNS
 * suffix, bun path, and repo path are discovered at install time and baked
 * into the rendered plists under ~/Library/LaunchAgents.
 */

import { join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";

const TAILSCALE_CANDIDATES = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "tailscale"];

interface TailnetIdentity {
  /** This machine's MagicDNS name, without the trailing dot. */
  selfDnsName: string;
  /** The tailnet's MagicDNS suffix (e.g. example.ts.net). */
  magicDnsSuffix: string;
  /** The login name of the user this node belongs to (e.g. user@github). */
  loginName?: string;
}

async function tailnetIdentity(): Promise<TailnetIdentity> {
  for (const bin of TAILSCALE_CANDIDATES) {
    try {
      const status = await $`${bin} status --json`.quiet().json();
      const selfDnsName = (status?.Self?.DNSName as string | undefined)?.replace(/\.$/, "");
      const magicDnsSuffix = status?.MagicDNSSuffix as string | undefined;
      const userId = status?.Self?.UserID as number | undefined;
      const loginName = status?.User?.[String(userId)]?.LoginName as string | undefined;
      if (selfDnsName && magicDnsSuffix) return { selfDnsName, magicDnsSuffix, loginName };
    } catch {
      // try the next candidate
    }
  }
  throw new Error("Could not read tailscale status. Is Tailscale running and logged in?");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export interface AgentSpec {
  label: string;
  programArguments: string[];
  environment?: Record<string, string>;
}

export function renderPlist({ label, programArguments, environment }: AgentSpec): string {
  const args = programArguments.map((arg) => `\t\t<string>${escapeXml(arg)}</string>`).join("\n");
  const env = environment
    ? `\t<key>EnvironmentVariables</key>\n\t<dict>\n${Object.entries(environment)
        .map(
          ([key, value]) =>
            `\t\t<key>${escapeXml(key)}</key>\n\t\t<string>${escapeXml(value)}</string>`,
        )
        .join("\n")}\n\t</dict>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${escapeXml(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
${env}\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${escapeXml(`${process.env.HOME}/Library/Logs/${label}.log`)}</string>
\t<key>StandardErrorPath</key>
\t<string>${escapeXml(`${process.env.HOME}/Library/Logs/${label}.log`)}</string>
</dict>
</plist>
`;
}

async function installAgent(spec: AgentSpec, dryRun: boolean): Promise<void> {
  const plist = renderPlist(spec);
  const path = `${process.env.HOME}/Library/LaunchAgents/${spec.label}.plist`;

  if (dryRun) {
    console.log(`# ${path}\n${plist}`);
    return;
  }

  await Bun.write(path, plist);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await $`launchctl bootout ${domain}/${spec.label}`.quiet().nothrow();

  // Bootstrapping a label right after bootout races the old job's teardown
  // and fails with EIO, so retry until launchd accepts it.
  for (let attempt = 1; ; attempt++) {
    const result = await $`launchctl bootstrap ${domain} ${path}`.quiet().nothrow();
    if (result.exitCode === 0) break;
    if (attempt >= 5) {
      throw new Error(`launchctl bootstrap ${spec.label} failed: ${result.stderr.toString()}`);
    }
    await Bun.sleep(1000);
  }
  console.log(`installed ${spec.label} (${path})`);
}

if (import.meta.main) {
  const argv = cli({
    name: "install",
    help: {
      description:
        "Render and install the tsidp, mcp-gate, and things-mcp LaunchAgents for this machine.",
    },
    flags: {
      port: {
        type: Number,
        default: 3111,
        description: "Loopback port for the gate (the funnel target)",
      },
      serverPort: {
        type: Number,
        default: 3112,
        description: "Loopback port for the plain Things MCP server behind the gate",
      },
      path: {
        type: String,
        default: "/mcp",
        description: "URL path of the MCP endpoint (supports multiple servers per host)",
      },
      authorizationServer: {
        type: String,
        description: "OAuth authorization server URL (default: https://idp.<magic-dns-suffix>)",
      },
      tsidpBin: {
        type: String,
        default: `${process.env.HOME}/src/go/bin/tsidp`,
        description: "Path to the tsidp binary",
      },
      skipTsidp: {
        type: Boolean,
        default: false,
        description: "Only install the MCP server agent",
      },
      dryRun: {
        type: Boolean,
        default: false,
        description: "Print rendered plists instead of installing",
      },
    },
  });

  const { port, serverPort, path, tsidpBin, skipTsidp, dryRun } = argv.flags;
  const identity = await tailnetIdentity();
  const authorizationServer =
    argv.flags.authorizationServer ?? `https://idp.${identity.magicDnsSuffix}`;
  const resource = `https://${identity.selfDnsName}${path}`;
  // Prefer the PATH symlink over process.execPath, which resolves to a
  // version-pinned Cellar path that dangles after a brew upgrade.
  const bun = Bun.which("bun") ?? process.execPath;

  if (!skipTsidp) {
    await installAgent(
      {
        label: "me.bendrucker.tsidp",
        programArguments: [
          tsidpBin,
          "-funnel",
          "-hostname",
          "idp",
          "-dir",
          `${process.env.HOME}/.local/state/tsidp`,
        ],
        environment: { TAILSCALE_USE_WIP_CODE: "1" },
      },
      dryRun,
    );
  }

  await installAgent(
    {
      label: "me.bendrucker.things-mcp",
      programArguments: [
        bun,
        join(import.meta.dirname, "server.ts"),
        "--port",
        String(serverPort),
        "--path",
        path,
      ],
    },
    dryRun,
  );

  await installAgent(
    {
      label: "me.bendrucker.mcp-gate",
      programArguments: [
        bun,
        join(import.meta.dirname, "gate.ts"),
        "serve",
        "--port",
        String(port),
        "--upstream",
        `http://127.0.0.1:${serverPort}${path}`,
        "--authorization-server",
        authorizationServer,
        "--resource",
        resource,
      ],
    },
    dryRun,
  );

  if (!dryRun) {
    console.log(`\nresource URL: ${resource}`);
    console.log(`authorization server: ${authorizationServer}`);
    console.log(`publish the gate: tailscale funnel --bg ${port}`);
    console.log(
      `approve a user: bun ${join(import.meta.dirname, "gate.ts")} approve ${identity.loginName ?? "<login>"}`,
    );
  }
}
