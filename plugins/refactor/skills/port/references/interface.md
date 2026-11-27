# Adopting an Interface

When the target is an interface someone else defines, such as a framework's store or client protocol, the interface sets the method signatures and the old implementation still sets the behavior callers rely on.

- Compare at the callers. Run the harness on what callers observe through their existing entry points, with old and new behind them.
- List every place the interface's contract differs from what callers rely on: sync versus async, ordering, what a limit or page counts, identity and timestamps, missing-key and error behavior, transaction scope, and the format of data already persisted. Each one is a ledger row before any code changes.
- Settle each row one of three ways: the new implementation reproduces the old behavior inside the interface, a caller-side adapter restores it, or the user signs off on the change. Report which, row by row.
- Treat data the old implementation already wrote as real input. The new implementation reads the existing files or rows, and the harness compares what callers get back.
- Move callers over one at a time, re-running the harness after each.
