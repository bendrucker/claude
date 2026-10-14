# Machines

`herdr machine list` names the SSH machines saved here. `herdr --machine <label> <command>` forwards a single API command to one of them, from the `api`, `agent`, `pane`, `workspace`, `worktree`, `tab`, and `notification` groups. Everything else is local management, rejected with exit 2 before the network. Nothing forwarded runs git or writes a file, so a machine answers for its panes and agents and for nothing in its checkouts.

IDs repeat across machines and don't name the machine they belong to. The skill's orientation block and your own `HERDR_*` variables both describe this machine, so their IDs take a bare command. An ID from another machine's listing takes `--machine <label>` on every command touching it.

A saved machine is not a reachable one: the listing reports what the config holds rather than what answers, and probing to find out costs seconds per sleeping machine. Report a connection failure as "machine `<label>` is unreachable" rather than quoting herdr's error, which names the SSH target. That failure is the result, and herdr runs nothing here in its place.
