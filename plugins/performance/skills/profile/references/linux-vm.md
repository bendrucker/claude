# Linux VM

Move profiling or benchmarking into a Linux VM when macOS blocks the measurement the climb needs:

- `samply` and `dtrace` cannot attach to SIP-protected binaries (`/bin/*`, `/usr/bin/*`), and the program's hot path runs through one.
- The fast signal needs `perf`, eBPF, or hardware counters, which macOS lacks.
- System tracing needs `sudo` the user will not grant for every run.
- The A/A run on the Mac will not tie at any affordable run count.

## When the Result Transfers

A Linux result stands in for macOS when the hot path is platform-neutral code: parsing, hashing, allocation patterns, algorithmic work. Rankings and a candidate's direction transfer. Absolute times do not.

It does not transfer when the time goes to what differs between the platforms:

- Code behind a platform switch (`#[cfg(target_os = "macos")]`, `runtime.GOOS`, `process.platform`, `sys.platform`).
- Process spawn and dynamic linking, which cost more on macOS. macOS also checks each executable the first time it sees that content, so a test that writes fresh stub scripts pays the check on every run.
- Filesystem behavior: APFS against ext4, `fsync` (macOS needs `F_FULLFSYNC` to reach the disk), case-insensitive lookups, `clonefile`, FSEvents against inotify.
- Event and syscall layers: kqueue against epoll, and the system allocator.

Split a climb whose profile has both kinds: measure candidates that target a platform-specific cost on the Mac, and move the platform-neutral ones to the VM. When the metric is a macOS number, confirm the final base-against-final comparison on the Mac, even when every candidate was screened in the VM.

## Local VM

Lima on Apple Virtualization (`vmType: vz`) runs an arm64 Linux guest on the same CPU:

```bash
limactl start --name=perf --vm-type=vz --cpus=4 --memory=8 template:default
limactl shell perf
```

Use it to profile and to count work:

- `perf` software events, `ptrace`, `strace`, `bpftrace`, and `samply` work inside it.
- Apple Virtualization exposes no PMU, so `perf stat` reports cycles and instructions as `<not supported>`.
- Its timing inherits host noise: vCPUs land on efficiency cores, and the host throttles under thermal load. Trust its wall time only after an A/A run ties.

When `limactl` is not installed, tell the user it is missing.

## Cloud VM

An EC2 Graviton instance (`c8g`) gives stable timing: fixed clock frequency and one physical core per vCPU. Sizes below `c8g.16xlarge` expose a reduced set of hardware counters. `c8g.16xlarge` and `c8g.metal-24xl` expose the full set. Pick the smaller size for timing and the larger one when the fast signal is a counter the smaller one lacks.

Reach it through the user's launcher: a CLI that creates an instance, connects to it, extends its time limit, and destroys it. The user's environment supplies the launcher, its account, and its profile, so read its `--help` before the first launch. When no launcher exists, tell the user and stop at the local VM.

Set the time limit at launch:

- Size it from the climb's expected duration: the A/A run plus each candidate's measurement at the harness's per-run cost, plus half again. A run cut off by the limit repeats its setup and measurements, which costs more than idle margin.
- Extend it when the climb outgrows it, before a measurement runs into shutdown.
- Tell the user the limit and the instance type.

When two climbs share one VM, pin each to its own cores with `taskset -c <range>`, and have each ask the other before extending or destroying it.

When the launcher registers the VM as a herdr machine, run measurements in a herdr workspace on it, per the hill-climb skill's Workspace section.

## Getting the Code In

Copy the working tree into the VM's own disk and build there. A shared host mount runs through virtiofs, which adds its own filesystem cost to every measurement.

- Lima: `rsync -a -e "ssh -F ~/.lima/perf/ssh.config" <repo>/ lima-perf:<repo-name>/`. `limactl copy -r` works without `rsync`.
- Cloud: use the launcher's copy command, or push the arms' commits to a remote the instance can clone.

Keep `.git` so each arm builds from its ref with `git worktree add`, as on the Mac. Build every arm inside the VM for its architecture, since a binary built on the host for macOS does not run there.

- Copy the benchmark skill's `scripts/compare.ts` into the VM outside any `node_modules` tree, and run it with the same arms and flags as on the Mac. Bun resolves its imports on first run, which needs network access.
- When `bun`, `hyperfine`, or `perf` is missing in the VM, tell the user.
- Copy `tmp/bench/<comparison>` back to the host to keep the exports beside the notes file.

## Checks on Arrival

Run these before the first measurement, and record the results in the notes file:

- `cat /proc/sys/kernel/perf_event_paranoid`. `samply` and unprivileged `perf` need 1 or lower. Lower it with `sudo sysctl kernel.perf_event_paranoid=1`, which changes only the VM.
- `perf list hw` shows which hardware counters exist. An empty list means the fast signal falls back to software events or work counts.
- An A/A run with `compare.ts` measures the VM's noise floor. Compare it with the Mac's before moving timing work there.

## Cleanup

Destroy the VM when the climb ends: `limactl delete -f perf` locally, or the launcher's destroy command in the cloud. The time limit is a backstop, and the instance bills until it fires. Record the teardown in the notes file.
