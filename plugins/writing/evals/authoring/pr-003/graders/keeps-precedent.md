---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?((test.{0,20}helpers?|NewTestIOStreams).{0,80}(value|pointer)|(value|pointer).{0,80}(test.{0,20}helpers?|NewTestIOStreams))'
flags: i
match: contains
---
The body keeps the precedent: `genericclioptions`'s own test helpers already return an `IOStreams` value instead of a pointer.
