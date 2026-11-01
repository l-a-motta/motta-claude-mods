---
aliases: [Operating Systems deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/core-concepts]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Core Concepts]]"
basics: "[[Operating Systems]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Core Concepts]] › [[Operating Systems]] › 🔬 Deep Dive

> [!tldr] For engineers
> The kernel virtualizes CPU, memory and storage behind a **privilege boundary** that programs cross with system calls. For system design, four things matter most: what crossing that boundary costs (syscalls, context switches, page faults), how one process waits on thousands of sockets (`epoll`), what "written" really means (`fsync`), and the isolation primitives containers are made of (namespaces and cgroups).

> [!basics]- New to this? Start with the basics
> [[Operating Systems]] explains it with no jargon.

## How it really works

### Limited direct execution

Programs run directly on the CPU for speed, but in **user mode**, where the hardware forbids I/O and access to arbitrary physical memory.[^1] A system call executes a **trap** instruction: the hardware jumps to a handler the kernel registered at boot and raises the privilege level to **kernel mode**; a return-from-trap drops back to user mode where the program left off.[^1] A typical OS exports a few hundred system calls.[^1]

The kernel regains the CPU from a program that never makes a system call through a **timer interrupt**, programmed to fire every few milliseconds.[^2] The scheduler then decides whether to keep running the current process or perform a **context switch**: save the current process's registers to its kernel stack and process structure, restore another's, and return-from-trap into it.[^2] Before timer interrupts, cooperative systems such as early Mac OS could only recover from an infinite loop by rebooting.[^2]

### Processes and threads

A process is a running program with a private address space. On Linux, `fork()` creates a child by duplicating the caller; thanks to **copy-on-write**, "the only penalty that it incurs is the time and memory required to duplicate the parent's page tables" plus a new task structure.[^3] A **thread** is another execution point inside the same process: it has its own stack but shares the address space, which makes communication cheap and races possible.[^4] When two threads update shared data without coordination, the result depends on timing, which is called a race condition.[^4]

### Virtual memory

Every address a user program sees is virtual.[^5] Virtual memory aims for **transparency** (the program believes it has private memory), **efficiency** and **protection**: no load, store or instruction fetch may touch another process or the kernel.[^5] Hardware translates addresses through page tables, and a **TLB** caches recent translations. With typical 4 KB pages, a dense array scan incurs roughly one TLB miss per page, because of spatial locality.[^6] TLB replacement uses LRU or random policies; LRU degrades badly when a loop touches n + 1 pages with an n-entry TLB.[^6]

### Waiting on many sockets

A server holding thousands of mostly idle connections would waste a thread on each, so the kernel offers readiness notification instead. The old `select()` only handles descriptor numbers below `FD_SETSIZE` (1024), and its man page says modern applications should use `poll(2)` or `epoll(7)` instead.[^7] An epoll instance keeps an **interest list** of watched descriptors and a **ready list** of those with pending I/O; `epoll_wait` blocks until something is ready, and the design "scales well to large numbers of watched file descriptors".[^8]

```c
int ep = epoll_create1(0);
epoll_ctl(ep, EPOLL_CTL_ADD, listen_fd, &(struct epoll_event){.events = EPOLLIN, .data.fd = listen_fd});
for (;;) {
    int n = epoll_wait(ep, events, MAX_EVENTS, -1);   // sleep until something is ready
    for (int i = 0; i < n; i++) handle(events[i].data.fd);
}
```

Level-triggered mode is the default and behaves like a faster `poll`. Edge-triggered mode (`EPOLLET`) reports only changes, so callers must use nonblocking descriptors and drain each one until `EAGAIN`, or they may block with data still unread.[^8]

### Durability: the page cache and fsync

A `write()` normally lands in the kernel's buffer cache, not on the device. `fsync()` flushes the file's modified in-core pages to storage, including a disk cache if present, so the data survives a crash.[^9] It does not guarantee the directory entry reached disk; a newly created file also needs an `fsync` on its directory.[^9] Databases build their commit protocol on this. PostgreSQL's write-ahead log means only the sequential WAL file must be flushed at commit, not every data page touched.[^10]

### Isolation: namespaces and cgroups

A **namespace** wraps a global resource so processes inside it see their own isolated instance; "one use of namespaces is to implement containers".[^11] Linux has eight kinds:

| Namespace | Isolates |
| --- | --- |
| PID | Process IDs |
| Network | Network devices, stacks, ports |
| Mount | Mount points |
| UTS | Hostname and NIS domain name |
| IPC | System V IPC, POSIX message queues |
| User | User and group IDs |
| Cgroup | Cgroup root directory |
| Time | Boot and monotonic clocks |

Namespaces control what a process can *see*; **cgroups** control what it can *use*. Control Group v2 organizes processes in a hierarchy and distributes resources along it through controllers such as `cpu`, `memory`, `io` and `pids`.[^12] `memory.max` is a hard limit: if usage can't be reclaimed below it, the OOM killer runs inside that cgroup only. `memory.high` instead throttles the group under reclaim pressure without invoking the OOM killer.[^12] `cpu.max` takes `$MAX $PERIOD`: the group may use `$MAX` microseconds of CPU per `$PERIOD`.[^12]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Process per worker | Strong isolation; a crash kills one worker | Higher memory; IPC needed to share state |
| Threads in one process | Cheap sharing of memory | Races; one bad thread can corrupt all |
| Event loop on `epoll` | Thousands of idle connections per thread | Callback complexity; one slow handler stalls the loop |
| `select()` | Portable, simple | Hard limit at descriptor 1023[^7] |
| `fsync` on every commit | No acknowledged write is lost | Each commit waits on the device |
| Group commit (one WAL flush for many transactions) | Amortizes flush cost[^10] | Commits may wait briefly to share a flush |
| `memory.max` | Hard ceiling protects neighbors | OOM kills inside the group |
| `memory.high` | Graceful throttling, no kill | Limit can be overrun briefly |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| System call, 1996 (Linux 1.3.37, 200 MHz P6) | ~4 µs[^2] |
| Context switch, same system | ~6 µs[^2] |
| Same operations on 2–3 GHz CPUs | Sub-microsecond[^2] |
| Typical page size | 4 KB[^6] |
| System calls exported by a typical OS | A few hundred[^1] |
| `select()` limit | Descriptors below 1024[^7] |
| Kernel memory per epoll watch | ~160 bytes on 64-bit, ~90 bytes on 32-bit[^8] |
| Default `epoll` `max_user_watches` | 4% of low memory ÷ cost per watch[^8] |
| Default `cpu.max` | `max 100000`: no limit, 100 ms period[^12] |

OSTEP notes that many OS operations are memory-bound, and memory bandwidth has not kept pace with processor speed, so a faster CPU may not speed up the kernel as much as expected.[^2]

## Failure modes

- **OOM kills in containers.** A container that can't be reclaimed below `memory.max` has processes killed by its cgroup's OOM killer, which looks like a restart with no application error.[^12] Set `memory.high` below `memory.max` to get throttling and a warning signal first, and set `memory.oom.group` when a partial kill would leave the workload broken.[^12]
- **CPU quota stalls.** With `cpu.max`, a group that spends its quota early waits for the next period, which can show up as tail latency.[^12] Size quotas for peak parallelism, not average load.
- **Descriptor exhaustion.** Code still on `select()` fails past descriptor 1023.[^7] Move to `epoll` and raise per-process descriptor limits.
- **Lost writes after a crash.** Data written but never fsynced, or a new file whose directory was never fsynced, can vanish on power loss.[^9]
- **Edge-triggered hangs.** Reading only part of the available data under `EPOLLET` leaves the descriptor quiet forever.[^8]
- **Races.** Threads sharing memory without locks produce indeterminate results that differ run to run.[^4]

## In the real world

- **Docker** builds containers from Linux namespaces: "each aspect of a container runs in a separate namespace".[^13] Memory and CPU caps are the job of cgroups.[^12]
- **Android** runs a kernel based on an upstream Linux long-term-support release with Android-specific patches; since 5.10 these are Generic Kernel Images that separate core code from vendor modules.[^14]
- **PostgreSQL** relies on WAL plus `fsync` for durability, and one WAL flush can commit many concurrent transactions.[^10]
- **lmbench** is the classic tool for measuring syscall and context-switch costs on a given machine.[^2]

## In a design interview

The OS shows up as the reason behind numbers, not as its own box. Use it to justify choices:

1. **Connections:** "One event loop per core on `epoll`, so 50,000 mostly idle WebSocket connections don't need 50,000 threads."
2. **Isolation:** "Each service in its own container, with `memory.max` set from load tests so one leak can't starve its neighbors."
3. **Durability:** "A write is acknowledged only after the WAL is fsynced; that flush, not the network, sets our write latency floor."

Interviewers probe: *threads or processes?* (isolation vs. sharing), *why does the container keep restarting?* (OOM in its cgroup), *what happens on power loss?* (only fsynced data survives), *why not a thread per request?* (memory per stack and context-switch overhead at high concurrency).

## Check yourself

> [!question]- Why is `fork()` cheap on Linux even for a process using gigabytes of memory?
> Copy-on-write. The child shares the parent's pages until one of them writes, so `fork()` only duplicates page tables and a task structure.

> [!question]- A service creates a file, writes to it, calls `fsync` on the file and crashes. After reboot the file is missing. How?
> `fsync` on the file doesn't guarantee its directory entry reached disk. The directory also needs an `fsync`.

> [!question]- A container has `memory.max` set and processes inside it are killed under load. What alternative gives earlier warning?
> Set `memory.high` below the hard limit. Crossing it throttles the group under reclaim pressure without invoking the OOM killer, which buys time and shows up in metrics.

## Further reading

- 📘 [Operating Systems: Three Easy Pieces](https://pages.cs.wisc.edu/~remzi/OSTEP/) — the best free OS textbook, with short chapters on every mechanism here.
- 📄 [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) — the canonical reference, including the edge-triggered pitfalls.
- 📄 [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) — the kernel's own guide to the resource limits containers rely on.
- 📄 [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) — short, precise and essential for anyone storing data.
- 📄 [namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html) — what each namespace isolates and how to inspect them.

## Related

- [[Concurrency (Deep Dive)]] — threads, locks and the races they prevent.
- [[Networking (Deep Dive)]] — what the kernel does with packets once `epoll` says a socket is ready.
- [[Databases (Deep Dive)]] — WAL and fsync as the basis of durability.
- [[Cloud & Infrastructure (Deep Dive)]] — containers and VMs as units of deployment.
- [[Serverless (Deep Dive)]] — isolation and cold starts built on these primitives.

> [!nav] Keep going
> ← [[Data Structures (Deep Dive)|Data Structures]] · [[Core Concepts|🧠 Core Concepts]] · [[Networking (Deep Dive)|Networking]] →
> 🌱 Back to the basics: [[Operating Systems]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📘 [Introduction to Operating Systems](https://pages.cs.wisc.edu/~remzi/OSTEP/intro.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 2. Book. Checked 2026-11.
[^2]: 📘 [Mechanism: Limited Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 6. Book. Checked 2026-11.
[^3]: 📄 [fork(2)](https://man7.org/linux/man-pages/man2/fork.2.html) — Linux manual page. Official docs. Checked 2026-11.
[^4]: 📘 [Concurrency: An Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 26. Book. Checked 2026-11.
[^5]: 📘 [The Abstraction: Address Spaces](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-intro.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 13. Book. Checked 2026-11.
[^6]: 📘 [Paging: Faster Translations (TLBs)](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-tlbs.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 19. Book. Checked 2026-11.
[^7]: 📄 [select(2)](https://man7.org/linux/man-pages/man2/select.2.html) — Linux manual page. Official docs. Checked 2026-11.
[^8]: 📄 [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) — Linux manual page. Official docs. Checked 2026-11.
[^9]: 📄 [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) — Linux manual page. Official docs. Checked 2026-11.
[^10]: 📄 [Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/current/wal-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^11]: 📄 [namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html) — Linux manual page. Official docs. Checked 2026-11.
[^12]: 📄 [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) — The Linux Kernel documentation. Official docs. Checked 2026-11.
[^13]: 📄 [What is Docker?](https://docs.docker.com/get-started/docker-overview/) — Docker documentation. Official docs. Checked 2026-11.
[^14]: 📄 [Kernel overview](https://source.android.com/docs/core/architecture/kernel) — Android Open Source Project. Official docs. Checked 2026-11.
