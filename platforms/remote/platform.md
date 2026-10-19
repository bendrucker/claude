# Remote

- This is a Linux VM with the GNU userland. The tools pinned in dotfiles `system/mise.toml` are on `PATH`, from the clone at `/opt/dotfiles`.
- herdr, worktrunk (`wt`), Things, and Secretive are absent. Skills that name them don't apply here.
- `~/.claude-repo` fast-forwards from `main` at session start, so a merged change to `bendrucker/claude` goes live in the next session.
- The device folder tools run in a small Linux arm64 VM on my Mac that mounts the approved folders, not on the Mac itself. It has none of the Mac's tools, its proxy blocks package installs, and its few GB of RAM can't hold the session index's working set. Don't install or ship binaries into it: give me a command to run on the Mac instead. Open a database on a mount only read-only, since a process on the Mac may be writing it.
