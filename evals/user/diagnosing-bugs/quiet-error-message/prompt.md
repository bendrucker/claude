When the config file is missing, `bun run deploy` dies with `Error: config not found`, which is expected, but it doesn't say where it looked. Make that error message include the path it checked.
