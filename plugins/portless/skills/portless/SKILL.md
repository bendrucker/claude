---
name: portless
description: >-
  Portless-managed dev servers and stable .localhost URLs. Use when starting
  a dev server, navigating to a local URL in a browser, testing UI changes,
  or debugging why a port-based URL isn't reachable.
---

# Portless

[portless](https://github.com/vercel-labs/portless) fronts local dev servers with stable `https://<name>.localhost` URLs instead of random ports. A repo uses it when `package.json` scripts invoke `portless run`. Don't prepend `portless run` yourself unless those scripts already do.

## URL contract

- Inside a process spawned by `portless run`, `PORTLESS_URL` is authoritative.
- From outside, `portless get <name>` prints the URL (use `--no-worktree` to skip the branch prefix), or run `portless list` for all active routes.
- Otherwise the URL is `https://<name>.localhost`, where `<name>` is the `package.json` name (or `--name` / first positional arg to `portless`).
- `PORT` / `HOST` in the child env are the ephemeral upstream. Browsers hit the `.localhost` URL, not those.
- With `PORTLESS=0`, portless is bypassed: the dev server binds directly to `PORT`/`HOST`, no `.localhost` URL is routed, and `PORTLESS_URL` / `portless list` shouldn't be treated as authoritative. Use the port-based URL from the dev server's own output.

## Worktrees

In a linked git worktree, portless prepends the branch as a subdomain:

```
main worktree:   https://myapp.localhost
fix-ui worktree: https://fix-ui.myapp.localhost
```

Don't assume the bare name. If unsure, check `PORTLESS_URL` or `portless list`.

## Full docs

Installation, LAN mode, framework notes, HTTPS/CA trust, reserved names, and the complete CLI reference live in the upstream skill: [vercel-labs/portless SKILL.md](https://github.com/vercel-labs/portless/blob/main/skills/portless/SKILL.md).
