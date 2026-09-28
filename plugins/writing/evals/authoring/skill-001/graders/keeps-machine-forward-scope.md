---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:--machine[\s\S]{0,400}notification[\s\S]{0,300}exit 2|exit 2[\s\S]{0,300}notification[\s\S]{0,400}--machine)'
flags: i
match: contains
---
The Machines section names which command groups a `--machine` call can forward (through `notification`), and that everything else is local management rejected with exit 2 before the network.
