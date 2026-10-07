---
fail: []
---
<out>
Title: Allow use of Promise global

With increasing interesting in `async`/`await` and diminishing interest in Bluebird, it seems appropriate to allow applications to use `Promise` like any other global. We could still allow users to do `const Promise = require('bluebird')` (seems confusing) or make a breaking change preventing global overrides and promoting `const Bluebird = require('bluebird')`. I think in a world where Bluebird is on its way out as a standard feature of Node apps it's worth switching old apps to `Bluebird` as an identifier when they upgrade the linter.

See https://github.com/TakeScoop/kube-run/pull/1/files#r258305516
</out>
