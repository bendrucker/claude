---
fail: [reply-shape]
---
The pipeline list endpoint returns external pipelines (posted by other tools, carrying no CI jobs) and parent-pipeline children, and either can hold the highest id and trigger a false success.
