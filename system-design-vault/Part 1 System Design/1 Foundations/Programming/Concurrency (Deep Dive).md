---
aliases: [Concurrency deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/programming]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Programming]]"
basics: "[[Concurrency]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Programming]] › [[Concurrency]] › 🔬 Deep Dive

> [!tldr] For engineers
> Concurrency is a **structuring** problem (many independent activities in flight); parallelism is an **execution** property (several running at once). Every model, whether OS threads, virtual threads, event loops or goroutines with channels, has to answer the same question: who may touch shared state, and in what order. Get it wrong and you get data races, deadlocks or a stalled event loop; get the capacity math wrong and Amdahl's and Little's laws will correct you in production.

> [!basics]- New to this? Start with the basics
> [[Concurrency]] explains it with no jargon.

## How it really works

Rob Pike's framing is the cleanest: concurrency is the composition of independently executing processes, "about *dealing with* lots of things at once"; parallelism is the simultaneous execution of computations, "about *doing* lots of things at once".[^1] The Rust book uses the same split: concurrent parts *execute independently*, parallel parts *execute at the same time*.[^2]

### Execution models

**Platform threads.** A classic thread wraps an OS thread. The thread-per-request style is easy to write, debug and profile, but platform threads are too costly to create in large numbers, so a server runs out of threads before it runs out of CPU.[^3]

**Virtual threads (Java 21).** JEP 444 makes `java.lang.Thread` instances that are not tied to an OS thread; the JDK schedules many of them onto a few carrier threads, unmounting a virtual thread while it blocks.[^3] They exist for throughput, not lower latency.[^3] In JDK 21 a virtual thread blocking inside `synchronized` stayed **pinned** to its carrier; JDK 24 (JEP 491) lets it unmount there too, leaving native frames and class initialization as the remaining pinning cases.[^4]

**Event loop (Node.js).** One JavaScript thread runs callbacks in phases (timers, pending callbacks, poll, check, close), while non-blocking I/O is offloaded to the kernel and a completion callback is queued later.[^5] Expensive work such as `fs` calls, DNS lookups, `crypto.pbkdf2` and zlib goes to libuv's worker pool.[^6]

**Goroutines and channels (Go).** Go's slogan is "Do not communicate by sharing memory; instead, share memory by communicating": data is handed between goroutines over channels, so one goroutine owns it at a time.[^7]

**Python and the GIL.** CPython's global interpreter lock stops multiple threads from executing Python code at the same time, which blocks multi-core use from threads.[^8] PEP 703, accepted in October 2023, added a free-threaded build without the GIL starting with Python 3.13.[^8][^9]

### Shared memory and data races

Go's memory model gives the precise definition: a **data race** is a write to a memory location concurrent with another read or write to the same location, unless all accesses are atomic.[^10] Data-race-free programs behave as if all goroutines were interleaved on one processor (DRF-SC); racy ones can observe writes out of order, and in C and C++ a race is undefined behavior.[^10]

The classic lost update: `c++` is read, increment, write. Two threads that both read before either writes lose one update.[^11] The fix is to serialize access with a lock, an atomic or a channel.[^10]

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++                 // read-modify-write is now one critical section
}
```

Go's race detector, enabled with `go build -race`, uses ThreadSanitizer to report races at runtime.[^10] Rust goes further and rejects many such programs at compile time through ownership and the `Send` and `Sync` traits.[^2]

### Deadlock and livelock

A deadlock requires all four **Coffman conditions** (1971): mutual exclusion, hold and wait, no preemption and circular wait.[^12] Break any one and deadlock is impossible; the practical one to break is circular wait, by acquiring locks in a fixed global order (by ID or address).[^12] Oracle's tutorial shows the textbook case: two `synchronized` methods that each lock their own object and then call into the other.[^13] A **livelock** looks busy (threads keep changing state in response to each other) but makes no progress.[^12]

### The two laws of capacity

**Amdahl's law** caps speedup by the serial fraction: `S = 1 / ((1 − p) + p/s)`. With 95% parallel work the ceiling is 20×, however many cores you add.[^14]

**Little's law** links concurrency, throughput and latency: concurrency = throughput × latency. JEP 444's example: at 50 ms per request, 10 requests in flight give 200 requests/s, and reaching 2,000 requests/s needs about 100 in flight.[^3] That is why thread-per-request servers need cheap threads.

## Design choices and trade-offs

| Model | Gains | Costs |
| --- | --- | --- |
| Platform threads + locks | Familiar; true parallelism; simple blocking code[^3] | Expensive threads cap concurrency; races and deadlocks are on you |
| Virtual threads | Blocking code at high concurrency; same `Thread` API[^3] | No speedup for CPU-bound work; carrier pinning (in `synchronized` before JDK 24)[^3][^4] |
| Event loop (Node.js) | Non-blocking I/O for many clients on one thread; callbacks run one at a time[^5] | One slow callback stalls every client; CPU work must be offloaded[^6] |
| Channels / message passing (Go) | Ownership transfers make sharing explicit[^7] | Can still deadlock on channels; buffering choices matter |
| Ownership checked at compile time (Rust) | Many races become compile errors[^2] | Steeper learning curve |
| Separate processes | Isolation; sidesteps the GIL | Serialization cost; no shared objects[^6] |

| Primitive | Use for | Watch out for |
| --- | --- | --- |
| Mutex | Multi-step critical sections | Contention; lock ordering |
| Atomic | Single counters and flags[^10] | Doesn't compose across several variables |
| Channel / queue | Handing work or ownership between tasks[^7] | Unbounded queues hide overload |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| L1 cache reference / mutex lock-unlock / main memory reference | 0.5 ns / 25 ns / 100 ns[^15] |
| Java, 1-second tasks: 200 platform threads vs. virtual threads | ~200 tasks/s vs. ~10,000 tasks/s; example scales to 1,000,000 virtual threads[^3] |
| Little's law example | 50 ms × 10 in flight = 200 req/s; 2,000 req/s needs ~100 in flight[^3] |
| Amdahl ceiling at 95% parallel | 20×[^14] |
| CPython without the GIL, single-thread overhead (PEP 703 measurement) | 5–6% one thread, 7–8% multi-thread[^8] |
| Free-threaded build overhead today (pyperformance) | ~1% (macOS aarch64) to 8% (x86-64 Linux)[^9] |
| Node.js blocked by a 50 MB JSON string | ~0.7 s to stringify, ~1.3 s to parse[^6] |
| Therac-25 magnet-setting window in which edits went unseen | ~8 s[^16] |

## Failure modes

- **Lost updates and torn reads.** Unsynchronized read-modify-write loses writes;[^11] in Go, racy reads of multiword values such as slices, maps and interfaces can see inconsistent values and corrupt memory.[^10] Defense: a lock or atomic around every shared write, plus `-race` in CI.
- **Deadlock.** Two locks taken in opposite orders.[^13] Defense: a global lock order, timeouts with `tryLock`, or no nested locks at all.
- **Livelock and starvation.** Threads that back off and retry in lockstep never progress.[^12] Defense: randomized backoff.
- **Blocking the event loop.** A catastrophic-backtracking regex such as `(\/.+)+$` on hostile input, a `*Sync` API or a huge `JSON.parse` freezes every client and is a denial-of-service vector.[^6] Recursive `process.nextTick` can starve I/O too.[^5] Defense: bound input sizes, partition work with `setImmediate`, or offload to workers.[^6]
- **Virtual-thread pinning.** Blocking while pinned to the carrier thread quietly removes the scalability benefit; JDK Flight Recorder emits `jdk.VirtualThreadPinned`.[^3] On JDK 21–23 `synchronized` pins, so the defense there is `ReentrantLock` on hot blocking paths.[^3] From JDK 24 the remaining culprits are native code that calls back into Java and blocking in class initializers.[^4] Defense: upgrade, then watch the JFR event.
- **Concurrency bugs in safety-critical code.** In the Therac-25, a keyboard-handler task ran concurrently with the treatment task and signaled edits through a shared variable; edits typed quickly during magnet setup were missed, and the machine's settings no longer matched the screen.[^16] It was one of six massive-overdose accidents between 1985 and 1987.[^17] Defense: hardware interlocks, not software alone, and formal reasoning about shared state.

## In the real world

- **Node.js** serves many clients from one JavaScript thread plus a libuv worker pool, and its docs devote a whole guide to not blocking either.[^6]
- **Java 21** shipped virtual threads after previews in JDK 19 and 20, aimed at thread-per-request servers.[^3]
- **Go** builds concurrency around goroutines, channels and a race detector in the standard toolchain.[^7][^10]
- **Python** ships an optional free-threaded build since 3.13; importing a C extension that isn't marked safe can switch the GIL back on, with a warning.[^9]
- **Rust** markets "fearless concurrency": ownership and type checking turn many concurrency errors into compile-time errors.[^2]

## In a design interview

Concurrency hides in ordinary requirements: "don't oversell the last ticket", "count likes accurately", "two users book the same seat". The answer pattern:

1. **Name the shared state** and the invariant ("seats sold ≤ capacity").
2. **Pick a strategy:** avoid sharing (partition by key so one worker owns it), make the update atomic (a database transaction or compare-and-set), or serialize it (a per-key queue or lock).
3. **Size it with Little's law:** concurrency needed = target throughput × latency.[^3]
4. **Respect Amdahl:** find the serial bottleneck (one hot row, one global lock) before adding machines.[^14]
5. **Plan for failure:** lock timeouts, idempotent retries, and what happens if a lock holder dies.

Probes to expect: *Optimistic or pessimistic locking?* *What if two app servers hold the same in-memory lock?* (They don't share it; use the database or a distributed lock.) *Threads or async for this service?* (I/O-bound and many connections: async or virtual threads; CPU-bound: a bounded pool sized to cores.)

## Check yourself

> [!question]- A Node.js API slows to a crawl when one client uploads a large JSON body, even though CPU usage on other cores is low. Why?
> `JSON.parse` runs on the single event-loop thread, so while it parses, no other callback runs. Other cores sit idle because your JavaScript doesn't use them. Bound body size, stream-parse, or offload to a worker.

> [!question]- Which Coffman condition does a global lock order break, and why does that prevent deadlock?
> Circular wait. If every thread acquires locks in the same order, no cycle of "holds A, waits for B" can form, and all four conditions are needed for deadlock.

> [!question]- Your service has 80% parallelizable work. Leadership wants 10× from more cores. What do you tell them?
> Amdahl's ceiling is 1 / 0.2 = 5×, even with infinite cores. To go further, shrink the serial 20% (remove the global lock, shard the hot resource) rather than add hardware.

## Further reading

- 📝 [Concurrency is not parallelism](https://go.dev/blog/waza-talk) — Rob Pike's talk, the clearest framing of the two ideas.
- 📄 [The Go Memory Model](https://go.dev/ref/mem) — a precise, readable definition of data races and happens-before.
- 📄 [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — why thread-per-request scales again, with Little's law worked through.
- 📄 [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — every way to stall a single-threaded server, with fixes.
- 📄 [PEP 703: Making the Global Interpreter Lock Optional](https://peps.python.org/pep-0703/) — the engineering behind removing Python's GIL.

## Related

- [[Operating Systems (Deep Dive)]] — threads, scheduling and context switches underneath every model here.
- [[Databases (Deep Dive)]] — transactions and isolation levels are concurrency control for data.
- [[Message Queues (Deep Dive)]] — share memory by communicating, at system scale.
- [[Design Patterns (Deep Dive)]] — thread-safe singletons and observers.
- [[LLM Inference & Optimization (Deep Dive)]] — serving many concurrent requests on shared accelerators.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — Amdahl's law across GPUs and nodes.

> [!nav] Keep going
> ← [[Design Patterns (Deep Dive)|Design Patterns]] · [[Programming|💻 Programming]] · [[Data Structures (Deep Dive)|Data Structures]] →
> 🌱 Back to the basics: [[Concurrency]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Concurrency is not parallelism](https://go.dev/blog/waza-talk) — Andrew Gerrand on Rob Pike's talk, The Go Blog. Article. Checked 2026-11.
[^2]: 📄 [Fearless Concurrency](https://doc.rust-lang.org/book/ch16-00-concurrency.html) — The Rust Programming Language book. Official docs. Checked 2026-11.
[^3]: 📄 [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — OpenJDK. Official docs. Checked 2026-11.
[^4]: 📄 [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491) — OpenJDK. Official docs. Checked 2026-11.
[^5]: 📄 [The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — Node.js. Official docs. Checked 2026-11.
[^6]: 📄 [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js. Official docs. Checked 2026-11.
[^7]: 📝 [Share Memory By Communicating](https://go.dev/blog/codelab-share) — Andrew Gerrand, The Go Blog, 2010. Article. Checked 2026-11.
[^8]: 📄 [PEP 703: Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/) — Sam Gross, Python Enhancement Proposals. Official docs. Checked 2026-11.
[^9]: 📄 [Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html) — Python documentation. Official docs. Checked 2026-11.
[^10]: 📄 [The Go Memory Model](https://go.dev/ref/mem) — The Go Programming Language. Official docs. Checked 2026-11.
[^11]: 📄 [Thread Interference](https://docs.oracle.com/javase/tutorial/essential/concurrency/interfere.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^12]: 📖 [Deadlock (computer science)](https://en.wikipedia.org/wiki/Deadlock_%28computer_science%29) — Wikipedia. Encyclopedia. Checked 2026-11.
[^13]: 📄 [Deadlock](https://docs.oracle.com/javase/tutorial/essential/concurrency/deadlock.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^14]: 📖 [Amdahl's law](https://en.wikipedia.org/wiki/Amdahl%27s_law) — Wikipedia. Encyclopedia. Checked 2026-11.
[^15]: 📝 [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832) — jboner's GitHub gist of figures by Jeff Dean and Peter Norvig. Article. Checked 2026-11.
[^16]: 🔬 [An Investigation of the Therac-25 Accidents, Part II](https://web.mit.edu/6.033/2004/wwwdocs/papers/Therac_2.html) — Leveson and Turner, IEEE Computer, July 1993. Paper. Checked 2026-11.
[^17]: 🔬 [An Investigation of the Therac-25 Accidents](https://web.mit.edu/6.033/2004/wwwdocs/papers/Therac_1.html) — Leveson and Turner, IEEE Computer, July 1993. Paper. Checked 2026-11.
