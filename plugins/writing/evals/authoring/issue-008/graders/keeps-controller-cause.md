---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(deployment|replica.?set|controller).{0,60}(random|generat)'
flags: i
match: contains
---
The body keeps why it surfaces on a higher-order object: a Deployment or ReplicaSet generates a randomized pod name per context.
