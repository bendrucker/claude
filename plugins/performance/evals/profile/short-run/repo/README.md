# tokcount

Counts tokens and keywords in a source file. The editor plugin runs `build/tokcount <file>` on every save, so its latency is felt on each keystroke pause. `make` builds it, and `fixtures/large.c` is a typical large file.
