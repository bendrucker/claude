---
type: regex
pattern: 'trace_begin herdr-plugin-config\nherdr_plugin_config='
match: contains
target: { source: file, path: .eval-pushed-tree/scripts/install }
---
The branch's last commit wraps the herdr plugin config move in a trace span, in main's rewritten installer.
