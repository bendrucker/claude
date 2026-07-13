# Things MCP Server

Remote MCP access to Things 3 over Streamable HTTP, protected by OAuth against [tsidp](https://tailscale.com/docs/features/tsidp). One server backs every surface: claude.ai custom connector, Cowork, mobile, and Claude Code.

Reads run the existing JXA query scripts through the mac plugin's runner (`plugins/mac/scripts/jxa.ts`). Writes go through the existing `things:///` URL scheme modules (`scripts/url.ts`, `scripts/reorder.ts`). Because the server runs as an unsandboxed launchd process, no Claude Code sandbox overrides are involved anywhere.

## Layout

- `server.ts`: HTTP entry point. Loopback-only listener, stateless Streamable HTTP transport, bearer-token gate.
- `auth.ts`: RFC 9728 protected-resource metadata, RFC 7662 introspection verifier with caching.
- `tools.ts`: MCP tool registrations wrapping the plugin's read scripts and write modules.
- `jxa.ts`: locates and spawns the mac plugin's JXA runner (AST scope validation and Apple Events retry included).
- `launchd/`: LaunchAgent plists for tsidp and this server.

## Running Locally

```bash
bun src/mcp/server.ts --insecure-no-auth
```

Every request is accepted, so this mode is for local testing only. The server refuses to start without `--authorization-server` and `--resource` otherwise. Test with `bunx @modelcontextprotocol/inspector` against `http://127.0.0.1:3111/mcp`.

## Deployment

The server binds 127.0.0.1 and relies on Tailscale Serve/Funnel for TLS and public reachability. Auth is mandatory on the deployed path: tsidp issues opaque tokens, the server validates each one against tsidp's introspection endpoint.

One-time tailnet setup, in the Tailscale admin console:

1. Enable HTTPS certificates and Serve/Funnel for the tailnet (the `tailscale serve` / `tailscale funnel` CLIs print the exact enable URLs).
2. Add the application grant tsidp needs for MCP resource indicators to the tailnet policy:

```json
{
  "src": ["*"],
  "dst": ["*"],
  "app": {
    "tailscale.com/cap/tsidp": [
      { "users": ["*"], "resources": ["https://<host>.<tailnet>.ts.net/mcp"] }
    ]
  }
}
```

Then on the Mac:

```bash
# tsidp joins the tailnet as its own node named "idp".
# First run is interactive: it prints a login URL to authorize the node.
TAILSCALE_USE_WIP_CODE=1 ~/src/go/bin/tsidp -funnel -hostname idp -dir ~/.local/state/tsidp

# Once authorized, install both LaunchAgents.
cp launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/me.bendrucker.tsidp.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/me.bendrucker.things-mcp.plist

# Publish the server. Funnel exposes it to the public internet, which the
# claude.ai connector requires. Use `serve` instead for tailnet-only access.
tailscale funnel --bg 3111
```

The first tool call that touches Things prompts for a TCC Automation grant (the server binary controlling Things3). Approve it once in System Settings if the dialog is missed.

tsidp runs in Funnel mode so claude.ai can reach the token and registration endpoints. The `/authorize` step stays tailnet-only: completing the OAuth flow requires being on the tailnet, which is the access control.

## Surfaces

- claude.ai / Cowork / mobile: Settings → Connectors → Add custom connector, URL `https://<host>.<tailnet>.ts.net/mcp`. Dynamic Client Registration and the OAuth flow run against tsidp.
- Claude Code: `claude mcp add --transport http things https://<host>.<tailnet>.ts.net/mcp`, then `/mcp` to authenticate.

## Constraints

Writes need the Mac awake with a logged-in GUI session: both the JXA reads and the URL-scheme handoff require Things able to run. Mail to Things remains the zero-infrastructure capture fallback when the Mac is asleep.
