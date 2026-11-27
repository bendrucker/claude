# Production Ports

Extensions to the harness for a service ported under live traffic, from Anthropic's [Messages API migration to Rust](https://www.anthropic.com/research/migrating-api-to-rust).

## Shadow Traffic

Mirror live requests to the new implementation and compare its checkpoints against the old one's, while only the old one's response reaches the caller. Shadow only the stages that are side-effect free, or replay the expensive or nondeterministic call (the upstream API, the model) from the old path's recording. Count each request once toward billing, rate limits, and quotas.

Track the match rate over shadowed traffic as the cutover signal. Report the population each rate covers, since a change in traffic mix moves the rate without any fix.

## Private Payloads

When payloads cannot be read or logged, record the structure of each divergence instead: the checkpoint, the first differing byte offset, both lengths, and request metadata such as feature flags, model, and client. Those fields are enough to fingerprint and group. An agent can build a synthetic input from them that reproduces the row locally.

## Inner and Outer Loops

Give each fix a fast local check: build both implementations' checkpoint output for one input in under a second, with the slow dependency replayed from a script. A fix starts there and closes only once its fingerprint disappears from shadowed traffic, since a local match can still diverge in production.

## Drift During a Long Dual Run

While both implementations serve traffic, every change to the old one needs a matching change to the new one or a recorded exemption. Enforce it in CI. Turn recurring review corrections into lint rules and tests. The same mistake then fails a check before review.

## Cutover

Move traffic over in increments with a rollback switch. Keep shadow comparison running in reverse, new serving and old shadowing, through the first increments.
