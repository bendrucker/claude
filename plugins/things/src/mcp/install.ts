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
}

async function tailnetIdentity(): Promise<TailnetIdentity> {
  for (const bin of TAILSCALE_CANDIDATES) {
    try {
      const status = await $`${bin} status --json`.quiet().json();
      const selfDnsName = (status?.Self?.DNSName as string | undefined)?.replace(/\.$/, "");
      const magicDnsSuffix = status?.MagicDNSSuffix as string | undefined;
      if (selfDnsName && magicDnsSuffix) return { selfDnsName, magicDnsSuffix };
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
  await $`launchctl bootstrap ${domain} ${path}`;
  console.log(`installed ${spec.label} (${path})`);
}

if (import.meta.main) {
  const argv = cli({
    name: "install",
    help: {
      description: "Render and install the tsidp and things-mcp LaunchAgents for this machine.",
    },
    flags: {
      port: {
        type: Number,
        default: 3111,
        description: "Loopback port for the MCP server",
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

  const { port, path, tsidpBin, skipTsidp, dryRun } = argv.flags;
  const identity = await tailnetIdentity();
  const authorizationServer =
    argv.flags.authorizationServer ?? `https://idp.${identity.magicDnsSuffix}`;
  const resource = `https://${identity.selfDnsName}${path}`;

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
        // Prefer the PATH symlink over process.execPath, which resolves to a
        // version-pinned Cellar path that dangles after a brew upgrade.
        Bun.which("bun") ?? process.execPath,
        join(import.meta.dirname, "server.ts"),
        "--port",
        String(port),
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
    console.log(`publish it: tailscale funnel --bg ${port}`);
  }
}
