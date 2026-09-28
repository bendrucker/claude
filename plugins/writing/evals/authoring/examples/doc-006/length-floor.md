---
fail: [length-floor, keeps-argv-formatter-link, keeps-gitlog-docs-link, keeps-pretty-formats-link]
---
<out>
git-log-parser
==============

Run `git log` and return a stream of commit objects.

## Setup

```bash
$ npm install git-log-parser
```

## API

#### `log.parse(config)` -> `Stream(commits)`

Accepts a `config` object mapping to the [options accepted
</out>
