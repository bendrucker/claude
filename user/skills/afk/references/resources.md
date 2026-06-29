# Resource detection

The four detection commands run cleanly inside Claude Code's command sandbox. Read their raw output and classify as below.

## Power

```
pmset -g ps
```

Output names the active source. `Now drawing from 'AC Power'` is plugged in. `Now drawing from 'Battery Power'` is on battery, and the battery line shows a percentage.

A desktop has no battery. `pmset -g batt` prints no `InternalBattery` line on a desktop. Treat a desktop as always AC, with no battery constraint.

## Lid / clamshell

```
ioreg -r -k AppleClamshellState
```

A node block containing `"AppleClamshellState" = Yes` means the lid is closed (clamshell mode, usually driving an external display). `= No` means open. Empty output means the machine has no lid (desktop) or the key is absent. Treat empty as open.

## Tether

```
ifconfig | grep "inet "
```

An iPhone Personal Hotspot hands out addresses in the `172.20.10.0/28` subnet with gateway `172.20.10.1`, the same for USB and Wi-Fi. An `inet` line starting `172.20.10.` is therefore a reliable hotspot signal that covers both. The netmask reads `0xfffffff0` (/28). Ignore `utun`/`100.x` addresses (Tailscale) and loopback `127.0.0.1`.

Limits, stated honestly:

- SSID is redacted in current macOS and is not retrievable from the shell, so a non-iPhone hotspot or a captive metered Wi-Fi cannot be identified by name. The `172.20.10.0/28` check is specific to iPhone Personal Hotspot.
- The OS metered / Low Data Mode / "expensive" flag is not shell-readable.

When the subnet is ambiguous or unknown, prefer the conservative reading and gate bandwidth-heavy work.

## Sandbox caveat

`pmset`, `ioreg`, and `ifconfig` work in-sandbox and return through the normal Bash tool without a bypass prompt. `ifconfig` reads interface state directly, so it stays inside the sandbox.

Do **not** use `route -n get default`, `scutil --dns` / `scutil -r`, `ipconfig getifaddr`, or `netstat -rn` for interface, gateway, or reachability detection. They go through configd or raw sockets, which the command sandbox blocks. Grep `ifconfig` for the address instead.

## Gating table

Under any active constraint, defer the listed action classes and log each skipped step with its reason. Everything not listed proceeds normally.

| Action class | Battery | Tether | Closed lid |
| --- | --- | --- | --- |
| Package install (`npm install`, `bun install`, `brew install`, etc.) | defer | defer | defer |
| Large `git pull` / fetch / clone | proceed | defer | defer |
| Large download (assets, models, datasets) | defer | defer | defer |
| Heavy build (full compile, Docker build, image bake) | defer | proceed | defer |
| Edits, tests, lint, git commit, reviews, file reads | proceed | proceed | proceed |

Closed lid is the strictest gate: a lidded laptop is often thermally constrained and on a metered link, so defer both bandwidth- and power-heavy work. Battery gates power-heavy and bandwidth-heavy work but not ordinary fetches. Tether gates bandwidth-heavy work but not local compute.
