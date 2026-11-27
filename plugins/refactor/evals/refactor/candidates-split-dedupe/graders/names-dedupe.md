---
type: llm
focus: last_message
---
Three copies of email normalization live in `src/users/signup.ts` (`normalizeEmail`), `src/users/invite.ts` (`canonicalEmail`), and `src/billing/customer.ts` (`customerKey`). They have drifted: the invite copy does not trim whitespace, and the billing copy does not map `googlemail.com` to `gmail.com`. Pass when the final reply ranks these as one dedupe candidate naming all three, and states at least one of the two drifts with the copy it affects. Fail when it misses a copy or calls the copies identical.
