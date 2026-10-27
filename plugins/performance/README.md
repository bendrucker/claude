# performance

Profile, benchmark, and hill-climb software performance with noise-aware measurement.

## Skills

- `performance:profile`: rank where a program's time goes with `samply`, runtime profilers, or browser traces, and what holds its peak memory with `malloc_history` or `heaptrack`
- `performance:benchmark`: compare versions with interleaved `hyperfine` rounds, A/A noise floors, and permutation tests
- `performance:hill-climb`: improve a metric one measured change at a time, with the user reviewing the framing and early iterations

## Tests

```bash
bun test plugins/performance
```
