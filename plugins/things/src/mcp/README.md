# Things MCP Server

Remote MCP access to Things 3 over Streamable HTTP. One server backs every surface: claude.ai custom connector, Cowork, mobile, and Claude Code.

Auth lives in a separate gate process, an OAuth-protecting reverse proxy that could front any plain HTTP MCP server. Authentication comes from [tsidp](https://tailscale.com/docs/features/tsidp) (identity = your tailnet login, the authorize step only works on the tailnet). Authorization is the gate's own first-use approval store: an authenticated identity connecting for the first time is recorded as pending and denied until explicitly approved. Token validity alone is never enough.

```
claude.ai / Claude Code
        │ OAuth (DCR, authorize on tailnet, token)
        ▼
Tailscale Funnel ──► mcp-gate :3111 ──► things-mcp :3112 (loopback, no auth)
                        │ introspect + audience + grant store
                        ▼
                     tsidp (idp node)
```

Reads run the existing JXA query scripts through the mac plugin's runner (`plugins/mac/scripts/jxa.ts`). Writes go through the existing `things:///` URL scheme modules (`scripts/url.ts`, `scripts/reorder.ts`). Because the server runs as an unsandboxed launchd process, no Claude Code sandbox overrides are involved anywhere.

## Layout

- `server.ts`: the Things MCP server. Loopback-only, stateless Streamable HTTP, no auth code.
- `gate.ts`: the funnel-facing gate. RFC 9728 metadata, RFC 7662 introspection with RFC 8707 audience validation, first-use approval store, reverse proxy. Subcommands: `serve`, `approve`, `deny`, `list`.
- `auth.ts`: verifier and metadata helpers used by the gate.
- `grants.ts`: the JSON-file approval store (`~/.local/state/mcp-gate/grants.json`).
- `tools.ts`: MCP tool registrations wrapping the plugin's read scripts and write modules.
- `jxa.ts`: locates and spawns the mac plugin's JXA runner.
- `install.ts`: renders and installs the three LaunchAgents (tsidp, gate, server), discovering the tailnet host, MagicDNS suffix, and bun path at install time. Nothing machine-specific is committed.

## Running Locally

```bash
bun src/mcp/server.ts
```

The plain server binds 127.0.0.1 and accepts every request, so it is only exposed through the gate in deployment. Test with `bunx @modelcontextprotocol/inspector` against `http://127.0.0.1:3112/mcp`.

## Deployment

One-time tailnet setup, in the Tailscale admin console:

1. Enable HTTPS certificates and Serve/Funnel for the tailnet (the `tailscale serve` / `tailscale funnel` CLIs print the exact enable URLs).
2. Add the application grant tsidp needs for DCR and MCP resource indicators to the tailnet policy:

```json
{
  "src": ["*"],
  "dst": ["*"],
  "app": {
    "tailscale.com/cap/tsidp": [
      {
        "users": ["<login>"],
        "resources": ["https://<host>.<tailnet>.ts.net/mcp"],
        "allow_dcr": true
      }
    ]
  }
}
```

Then on the Mac:

```bash
# Build tsidp from its dedicated repo. The frozen copy at
# tailscale.com/cmd/tsidp lacks introspection and DCR.
go install github.com/tailscale/tsidp@latest

# tsidp joins the tailnet as its own node named "idp".
# First run is interactive: it prints a login URL to authorize the node.
TAILSCALE_USE_WIP_CODE=1 ~/src/go/bin/tsidp -funnel -hostname idp -dir ~/.local/state/tsidp

# Once authorized, render and install the three LaunchAgents. Use --dry-run
# to inspect the plists first, --skip-tsidp to reinstall only the MCP agents.
bun src/mcp/install.ts

# Publish the gate. Funnel exposes it to the public internet, which the
# claude.ai connector requires. Use `serve` instead for tailnet-only access.
tailscale funnel --bg 3111
```

The first tool call that touches Things prompts for a TCC Automation grant (the server binary controlling Things3). Approve it once in System Settings if the dialog is missed.

tsidp runs in Funnel mode so claude.ai can reach the token and registration endpoints. The `/authorize` step stays tailnet-only and identifies the visitor via WhoIs, so completing the OAuth flow requires being on the tailnet. Note that tsidp has no consent screen (authorize silently redirects), which is why the gate holds its own approval layer.

## First-Use Approval

The first connection from a new identity authenticates fine and then gets 403 with a pending grant. Approve it on the Mac:

```bash
bun src/mcp/gate.ts list
bun src/mcp/gate.ts approve <login>
```

Then retry the connection. `deny` blocks an identity permanently. The store lives at `~/.local/state/mcp-gate/grants.json` and the gate logs each denied attempt with the exact approve command.

## Surfaces

- claude.ai / Cowork / mobile: Settings → Connectors → Add custom connector, URL `https://<host>.<tailnet>.ts.net/mcp`. Dynamic Client Registration and the OAuth flow run against tsidp.
- Claude Code: `claude mcp add --transport http things https://<host>.<tailnet>.ts.net/mcp`, then `/mcp` to authenticate.

## Constraints

Writes need the Mac awake with a logged-in GUI session: both the JXA reads and the URL-scheme handoff require Things able to run. Mail to Things remains the zero-infrastructure capture fallback when the Mac is asleep.

Prior art: [Tailscale Aperture](https://tailscale.com/docs/aperture/mcp-server) proxies MCP servers with deny-by-default grants keyed on tailnet identity, but it is alpha and tailnet-only (no Funnel/public ingress), so it cannot serve claude.ai's cloud-originated connector calls. Worth revisiting for the on-tailnet surfaces if it matures.
