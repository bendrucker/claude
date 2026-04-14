---
name: portless
description: >-
  Portless-managed dev servers and stable .localhost URLs. Use when starting
  a dev server, navigating to a local URL in a browser, testing UI changes,
  or debugging why a port-based URL isn't reachable. Covers the
  <name>.localhost URL contract, worktree subdomain prefix, PORTLESS_URL env
  var, and the PORTLESS=0 bypass.
---

# Portless

[portless](https://github.com/vercel-labs/portless) fronts local dev servers with stable `https://<name>.localhost` URLs instead of random ports.

## Detecting portless

A repo uses portless when `package.json` scripts invoke `portless run` or `portless <name>`. For active routes:

```sh
portless list
```

## URL contract

- Inside a process spawned by `portless run`, `PORTLESS_URL` is authoritative.
- From outside the process, `portless get <name>` prints the URL (use `--no-worktree` to skip the branch prefix).
- Otherwise the URL is `https://<name>.localhost`. `<name>` comes from (in order): `--name <name>`, the first positional arg to `portless`, or the `package.json` name.
- `PORT` / `HOST` in the child env are the ephemeral upstream. Browsers hit the `.localhost` URL, not those.
- When driving `mcp__claude-in-chrome__navigate` or any browser tool, use the portless URL, not `localhost:<port>`.

## Worktrees

In a linked git worktree, portless prepends the branch as a subdomain:

```
main worktree:   https://myapp.localhost
fix-ui worktree: https://fix-ui.myapp.localhost
```

Don't assume the bare name. If unsure, check `PORTLESS_URL` or `portless list`.

## Running commands

- Prepend `portless run` only when the repo's scripts already do. Don't add it otherwise.
- `PORTLESS=0 <cmd>` bypasses the proxy (useful for debugging portless itself).
- HTTPS is on by default; `NODE_EXTRA_CA_CERTS` is injected into children so Node trusts the portless CA.

## Reserved names

`run`, `get`, `alias`, `hosts`, `list`, `trust`, `clean`, and `proxy` are subcommands and can't be used as app names. Use `portless run <cmd>` to infer the name, or `portless --name <name> <cmd>` to force it.

## Full docs

Installation, LAN mode, framework notes, HTTPS/CA trust, and the complete CLI reference live in the upstream skill: [vercel-labs/portless SKILL.md](https://github.com/vercel-labs/portless/blob/main/skills/portless/SKILL.md).
