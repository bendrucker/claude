I ran the tests, then sent signed requests to the server with unicode bodies, a 2 MB body, and duplicated `x-signature` headers. Only the duplicated header gave a 401, and nothing in your report says a sender does that, so it's a guess until a real rejected request shows it.

I can't reproduce the production 401s from here. Could you capture one rejected delivery (raw body bytes and every header)? I'll replay it against `verify()`.
