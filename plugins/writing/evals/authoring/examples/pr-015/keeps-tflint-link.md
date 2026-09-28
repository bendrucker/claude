---
fail: [keeps-tflint-link]
---
<out>Title: Add `ProtocolVersionError` type with client/server versions

This adds a `ProtocolVersionError` error type that is returned when encountering a client/server plugin API mismatch. This `error` exposes the `ClientVersions` and `ServerVersions`. The error string remains the same as it is currently.

This provides a mechanism for plugin authors to implement custom messaging around version mismatches. For example, if the plugin server version is greater than the offered client versions, you could tell the user "upgrade the client or downgrade the plugin."

Since the code is so simple I figured I'd offer this. Happy to work on other approaches as well.
</out>
