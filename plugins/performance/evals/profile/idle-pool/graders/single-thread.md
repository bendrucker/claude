---
type: regex
pattern: '^(?=[^\n]*(pool|worker|thread))(?=[^\n]*(idle|never (receive|get|used|dispatch)|unused|sit|single|one thread|main thread|serial))'
flags: im
match: contains
---
The reply notes that all the work runs on the main thread while the six pool workers sit idle.
