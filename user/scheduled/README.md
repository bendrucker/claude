# Scheduled Tasks

Repo-local, machine-grouped descriptors for launchd agents, reconciled by the `mac` plugin's [`scheduled`](../../plugins/mac/skills/scheduled/) skill. The descriptor format is in its [descriptor reference](../../plugins/mac/skills/scheduled/references/descriptor.md).

## Groups

A group is a directory of YAML descriptors, one task per file. The directory name is the group and scopes the launchd label (`me.bendrucker.claude.<group>.<label>`), so `/mac:scheduled sync` only ever installs, updates, or prunes agents within one group.

`home` (this directory) is committed and runs on the always-on Mac Studio. A work laptop manages its own group from `~/.config/claude-scheduled/<group>`, outside this repo, so proprietary task definitions never reach GitHub. Both kinds are declared the same way in a machine's `~/.config/claude-scheduled/config.json` (see the skill's setup reference), and `/mac:scheduled sync` reconciles them identically.

The descriptors stay here rather than in the plugin because they are this machine set's config, not something a marketplace install should receive. The config names this directory by absolute path, so the skill finds it from the plugin cache.
