# Vale

Fix Vale alerts in bulk through a Workflow, one rewrite agent per file.

## Contents

- `vale:fix`: preflight a Vale run into per-file shards, run one rewrite agent per file, then re-lint and restore any file whose rewrite added alerts

## Tests

```bash
bun test plugins/vale
```
