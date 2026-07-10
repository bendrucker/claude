---
name: prefer-headers
description: Fixture exercising the prefer-headers rule across its boundary cases.
---

# Fixture

**Config**: a line-start bold label should flag.

- **Item**: a list-item label should not flag.
1. **Step**: a numbered list-item label should not flag.

A sentence carrying **inline bold**: should not flag mid-sentence.

```md
**Fenced**: a bold label inside a fenced block should not flag.
```
