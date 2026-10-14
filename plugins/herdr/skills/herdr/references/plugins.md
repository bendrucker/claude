# Plugins

```bash
herdr plugin list
herdr plugin action list | jq -r --arg os macos '.result.actions[] | select(.platforms | index($os)) | "\(.plugin_id)  \(.action_id)  \(.title)"'
herdr plugin action invoke "$action_id" --plugin "$plugin_id"
```

Actions carry a `platforms` array and the CLI has no platform flag. Filter client-side, as above.

`herdr plugin log list` shows a plugin's command output, which is where to look when an action has no effect the user can see. `herdr plugin config-dir <plugin_id>` locates its config.

`herdr plugin pane open` needs `--entrypoint` alongside `--plugin`, and exits 2 without it. Its `--placement` then decides which of the addressing flags are legal, and each wrong one comes back `invalid_params`. `--help` lists four placements, and the binary also accepts `popup` and `fullscreen`.
