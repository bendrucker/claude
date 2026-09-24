The payment provider now signs its webhook requests with an HMAC in the `X-Signature` header, keyed by our shared secret. Add signature verification with TDD. Tests run with `bun test`.
