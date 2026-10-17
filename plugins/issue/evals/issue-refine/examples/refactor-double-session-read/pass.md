---
fail: []
---
<issue>
---
title: Read the session store once per request in auth middleware
type: refactor
---

`AuthMiddleware.__call__` hits the session store twice: `validate_token` reads it, then `load_user` reads it again. Read it once and pass the session record to both.

## 🤖 Agent Context

### Related Code

- `AuthMiddleware.__call__` at `auth/middleware.py:42` calls `validate_token` then `load_user`
</issue>
