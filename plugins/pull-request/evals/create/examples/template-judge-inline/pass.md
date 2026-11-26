---
fail: []
---
Title: comments: pass the judge workflow inline

## Summary

Fixes `comments:audit`: the Workflow tool loads a `scriptPath` only from the session's working directories.

## Changes

- The skill passes the script text through `script`.

## Testing

A one-shard audit ran end to end.

## Checklist

- [ ] Tests added or updated
- [ ] Docs updated
