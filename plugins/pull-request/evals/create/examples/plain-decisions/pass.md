---
fail: []
---
Title: plugins: give each plugin its own config

Each plugin now reads a `config.ts` of its own instead of `legacy/config.json`, so installing one plugin from the marketplace no longer needs the rest of the repo. A shared config package would force lint and format to version together, so the timeout is duplicated instead. The unused `verbose` flag is dropped. `legacy/config.json` stays because a dotfiles bootstrap script outside this repo still reads it.
