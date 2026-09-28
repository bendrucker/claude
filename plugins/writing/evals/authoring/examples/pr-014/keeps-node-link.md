---
fail: [keeps-node-link]
---
<out>
Title: Replace deprecated `fs.rmdir` with `fs.rm`

Fixes the following deprecation warning during cleanup:

```
(node:7106) [DEP0147] DeprecationWarning: In future versions of Node.js, fs.rmdir(path, { recursive: true }) will be removed. Use fs.rm(path, { recursive: true }) instead
(Use `node --trace-deprecation ...` to show where the warning was created)
```
</out>
