# sandbox-ssh-proxy

The `sandbox-ssh-proxy` hook makes git over SSH work inside the sandbox on macOS. The sandbox routes git's ssh through `GIT_SSH_COMMAND` with `ProxyCommand='nc -X 5 -x localhost:<port>'`, but its SOCKS proxy requires the per-session credentials it also puts in `ALL_PROXY`. macOS `nc` cannot send SOCKS credentials, so every sandboxed `git fetch` or `push` over SSH fails with `This proxy requires authentication, and this client did not offer an authentication method`, before ssh reaches the SSH agent. The Linux branch of the same harness code passes the credentials to `socat`, so the hook writes nothing off macOS.

The hook writes a snippet to `CLAUDE_ENV_FILE`, which each sandboxed command sources after the sandbox sets its variables. The snippet swaps in `ncat` (Homebrew `nmap`) with `--proxy-auth`. It targets `127.0.0.1` because `ncat` tries only `::1` for `localhost` and the proxy refuses that. A `git:*` sandbox exemption does not cover a pipeline into an unexcluded command, so a `git push 2>&1 | tail` takes the sandboxed path. Verified against CLI 2.1.291 with nested `claude --settings <file> -p` runs: a sandboxed `git ls-remote` over SSH failed without the hook and succeeded with it.

**Delete it** when a sandboxed `env` shows a `GIT_SSH_COMMAND` that carries the proxy credentials, at which point the snippet's `nc -X 5` match goes inert.
