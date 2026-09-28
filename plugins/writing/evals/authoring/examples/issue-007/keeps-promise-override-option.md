---
fail: [keeps-promise-override-option]
---
<out>
Title: Allow use of Promise global

With increasing interesting in `async`/`await` and diminishing interest in Bluebird, it seems appropriate to allow applications to use `Promise` like any other global. Make it a breaking change preventing global overrides and promoting `const Bluebird = require('bluebird')`.

See https://github.com/TakeScoop/kube-run/pull/1/files#r258305516
</out>
