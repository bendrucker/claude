## Needs Your Attention

- `notifier/digest.py:9` (resolved, no reply, not fixed): `build_digest` still interpolates `item.title` and `user.name` unescaped. Reopen.
- `notifier/digest.py:15` (resolved, no reply, mechanical): the key is lowercased, but the unsubscribe check still gets the raw address and users with no address still reach `deliver`. Reopen.
- `notifier/digest.py:23` (unresolved, fixed): `deliver` now backs off with a capped exponential sleep.

## Cleanly Addressed

`notifier/send.py`: logs and re-raises, resolved without a reply.

**Recommendation:** Request changes.
