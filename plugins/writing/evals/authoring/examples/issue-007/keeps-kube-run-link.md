---
fail: [keeps-kube-run-link]
---
<out>
Title: Allow use of Promise global

With increasing interesting in `async`/`await` and diminishing interest in Bluebird, it seems appropriate to allow applications to use `Promise` like any other global. We could still allow users to do `const Promise = require('bluebird')` (seems confusing) or make a breaking change preventing global overrides and promoting `const Bluebird = require('bluebird')`. I think it's worth switching old apps to `Bluebird` as an identifier when they upgrade the linter.
</out>
