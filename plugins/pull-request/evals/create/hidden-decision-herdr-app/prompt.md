Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

The `herdr` skill gains a branch that checks `HC_TERMINAL_ID` and points the session at the manuals `hc --skill` and `herdr-app --skill` print. The sandbox config adds one filesystem entry, `~/.local/state/herdr-core`. 4 files changed, +22/-2.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The Herdr app runs terminals in herdr-core (`hc`), a server separate from the herdr TUI, and the `herdr` CLI can't see sessions the app hosts.
- Pointing at the manuals `hc --skill` and `herdr-app --skill` print instead of copying commands, because they match the installed version.
- No status hook was added on purpose: Claude Code 2.1.314 already emits the OSC 7501 status herdr-core reads, so agent status works with no hook. I checked this live before dropping the hook I had drafted.
- The sandbox grant is the directory `~/.local/state/herdr-core`, because on macOS `XDG_RUNTIME_DIR` is unset and `hc` falls back there for `<session>.sock`. Granting the directory covers any `HC_SESSION` and the holder sockets. Paths come from herdr-core's `docs/security.md`.
- bendrucker/dotfiles#1001 installs the binaries.
- The `HERDR_ENV` call sites (attention.ts, review:human, the herdr mod, mod-events' multiplexer option) still target the TUI only and are no-ops under the app until herdr-core has pane tokens.
