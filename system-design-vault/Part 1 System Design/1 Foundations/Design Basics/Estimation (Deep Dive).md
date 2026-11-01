---
aliases: [Estimation deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/design-basics]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Design Basics]]"
basics: "[[Estimation]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Design Basics]] › [[Estimation]] › 🔬 Deep Dive

> [!tldr] For engineers
> Estimation is Fermi decomposition with **units carried and exponents right**: users → actions → QPS → peak QPS → concurrency → servers, and records × size × retention × replicas → storage. Latency is composed from a handful of memorized numbers, which drift with hardware, so know their era. The goal is the right order of magnitude and a quick comparison of designs, not a precise figure.

> [!basics]- New to this? Start with the basics
> [[Estimation]] explains it with no jargon.

## How it really works

### The method

Every estimate is a chain of rough multiplications. The napkin-math project boils the craft down to four habits: keep it simple (more than about six assumptions means you are overcomplicating it), **carry units** through every step, compute with **coefficients and powers of ten** because the exponent matters more than the coefficient, and decompose the question Fermi-style until each piece is guessable.[^1] ByteByteGo adds: round aggressively, write assumptions down so you can revisit them, and label units, since 5 KB and 5 MB are not interchangeable.[^2]

Useful constants: a day has 86,400 seconds (round to 10⁵), and 2¹⁰, 2²⁰, 2³⁰, 2⁴⁰, 2⁵⁰ are roughly a thousand, million, billion, trillion and quadrillion bytes (KB, MB, GB, TB, PB).[^2]

### Traffic: from users to peak QPS

ByteByteGo's worked exercise (its numbers are for practice, not Twitter's real figures):[^2]

```text
assume  300M MAU, 50% daily active, 2 posts/user/day, 10% with 1 MB media, keep 5 years
DAU            = 300M × 0.5             = 150M
write QPS      = 150M × 2 / 86,400      ≈ 3,500
peak QPS       ≈ 2 × 3,500              ≈ 7,000
media per day  = 150M × 2 × 0.1 × 1 MB  = 30 TB
media, 5 years = 30 TB × 365 × 5        ≈ 55 PB
```

Two refinements matter in practice. First, **read QPS** usually dwarfs write QPS; derive it from the requirements (feed views per user per day) rather than assuming. Second, the **peak factor** is product-specific. A 2x factor is a classroom default; Twitter's real 2013 peak was 143,199 tweets per second against a daily average of about 5,700, roughly 25x.[^3] Twitter's previous record had been 33,338.[^4]

### Latency: composing known numbers

Jeff Dean frames the skill as estimating a design's performance without building it, and illustrates it with an image-search results page of 30 thumbnails:[^5]

```text
Design 1, serial reads:   30 seeks × 10 ms + 30 × 256 KB / 30 MB/s  ≈ 560 ms
Design 2, parallel reads: 10 ms + 256 KB / 30 MB/s                  ≈ 18 ms
                          (ignores variance; really ~30–60 ms)
```

The calculation immediately shows which design is worth pursuing, and it suggests the next variations: cache single images or whole sets, or precompute thumbnails.[^5] The same slides estimate sorting 1 GB of 4-byte integers at about 30 seconds on one CPU by adding branch mispredictions (about 21 s) to memory-bandwidth time (about 7 s).[^5]

### Concurrency: Little's Law

**Little's Law** relates throughput, latency and work in flight: `L = λW`, where `L` is the average number of items in the system, `λ` the arrival rate and `W` the average time each item spends inside.[^6] It holds regardless of the arrival distribution, which makes it safe for rough sizing.[^6] Little proved it in 1961, and it is now used well beyond queueing theory, including in computer architecture.[^7]

```text
peak 7,000 req/s × 0.2 s average latency = 1,400 requests in flight
1,400 in flight / 200 concurrent requests per server ≈ 7 servers, before headroom
```

Per-server concurrency and throughput are not universal constants; measure them. Dean's advice is to write microbenchmarks, both to understand performance and to build intuition for exactly these calculations.[^5]

### From estimate to capacity plan

Production capacity planning adds redundancy and keeps the plan current. Google's SRE book describes the traditional loop (forecast demand, build a plan, get sign-off, deploy) as brittle, and spreadsheets as scaling badly and going stale.[^8] Its Auxon system instead takes intent such as "N + 2 per continent" or "frontends no more than 50 ms from backends" and generates the allocation.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Size for average load | Cheapest | Fails at the moments that matter most; peaks can be ~25x average[^3] |
| Size for peak plus redundancy (e.g. N+2) | Survives spikes and machine loss[^8] | Idle capacity most of the day |
| Serial vs parallel I/O | Serial is simpler | Serial latency adds up: 560 ms vs ~18 ms in Dean's example[^5] |
| Compute on the fly vs precompute | On the fly saves storage | Precomputing (e.g. thumbnails) cuts request latency[^5] |
| Round hard vs model precisely | Fast, easy to sanity-check[^2] | Can miss a constant factor; fine for design, not for purchasing |
| Spreadsheet plans vs intent-based planning | Spreadsheets are easy to start | Stale, error-prone, hard to scale[^8] |

## Numbers worth knowing

Latency tables age. Colin Scott's interactive version models how they drift: clock speeds grew until about 2005 and then stalled near 3 GHz, disk seek time improves slowly, and a transatlantic round trip stays near 150 ms because it is bound by the speed of light.[^9] Norvig's original figures date from 2002.[^9]

**Classic table (Norvig, Dean):**

| Operation | Time |
| --- | --- |
| L1 cache reference | 0.5 ns[^10] |
| Branch mispredict | 5 ns[^10] |
| Main memory reference | 100 ns[^10] |
| Compress 1 KB (Zippy) | 10 µs[^5] |
| Send 2 KB over a 1 Gbps network | 20 µs[^10] |
| Read 1 MB sequentially from memory | 250 µs[^10] |
| Round trip within one datacenter | 500 µs[^5] |
| Disk seek | 8–10 ms[^10][^5] |
| Read 1 MB sequentially from disk | 20–30 ms[^10][^5] |
| Packet US → Europe → US | 150 ms[^10] |

**Modern rounded figures (napkin-math):**[^1]

| Operation | Latency / throughput |
| --- | --- |
| Memory random read (64 B) | 100 ns |
| Memory sequential read, one thread | 20 GiB/s |
| SSD random read (8 KiB) | 100 µs |
| SSD sequential read | 4 GiB/s |
| HDD random read (8 KiB) | 10 ms |
| Network, same zone / cross zone | 100 µs / 500 µs |
| Network, cross-Atlantic | 80–100 ms |
| TLS 1.3 handshake (CPU) | 250 µs |
| Simple database query (MySQL, Redis, Memcached) | 500 µs |
| Blob storage read (128 KiB, zonal) | 50 ms |

Ratios are what you reason with: an SSD random read is about 1,000x a memory read, and a cross-ocean hop is about 1,000x a same-zone hop.[^1]

## Failure modes

- **Sizing for the average.** The Twitter record shows a one-second spike 25x the daily mean.[^3] Ask what the peak event is (a sale, a broadcast, a deadline) and size for it.
- **Ignoring variance.** Dean's own estimate is flagged as ignoring variance, with the realistic answer two to three times higher.[^5] With fan-out, the tail dominates: if each of 100 servers has a one-second p99, 63% of requests that wait for all of them take over a second.[^11]
- **Unit slips.** Bits versus bytes, KB versus MB, per-day versus per-second. Carrying units through each line catches these.[^1][^2]
- **Stale constants.** Using spinning-disk seek times for SSD-backed systems, or old network numbers, skews results by orders of magnitude.[^9]
- **Overfitting the estimate.** A dozen assumptions produce false precision; collapse them.[^1]
- **Forgetting multipliers.** Replication factor, indexes, backups and headroom for growth all multiply raw storage and compute.
- **Plans that rot.** Hand-maintained capacity spreadsheets drift from reality; Google moved to generating plans from declared intent.[^8]

## In the real world

- **Google** treats estimation as a core engineering skill; Dean's talk puts "numbers everyone should know" next to worked design comparisons.[^5] For fleet capacity, Auxon turns requirements into allocation plans automatically.[^8]
- **Twitter** absorbed a 143,199 tweets-per-second peak in August 2013 during a broadcast of *Castle in the Sky*,[^3] after re-architecting to remove bottlenecks.[^4]
- **napkin-math** maintains an up-to-date table of rounded numbers and exercises for first-principles estimates.[^1]

## In a design interview

Estimate only what changes the design, say each assumption aloud, and round.[^2]

1. **Traffic:** "10M DAU, 20 feed views and 1 post each per day: reads ≈ 200M / 10⁵ s ≈ 2,000 QPS, writes ≈ 100 QPS. Peak 5x: 10,000 read QPS."
2. **Storage:** "1 KB per post, 10M posts per day ≈ 10 GB per day ≈ 3.6 TB per year, times 3 replicas."
3. **Conclusion:** "Read-heavy at 100:1, so a cache in front of the feed; storage fits a few machines for years."

Interviewers probe: *Where did the peak factor come from?* *What is the read/write ratio?* *How many servers?* (Little's Law and a measured per-server rate.) *What breaks first at 10x?* The answer should lead naturally into [[Caching (Deep Dive)|caching]], [[Sharding (Deep Dive)|sharding]] or [[Load Balancing (Deep Dive)|load balancing]].

## Check yourself

> [!question]- A service handles 5,000 requests per second at a mean latency of 40 ms. On average, how many requests are in flight?
> By Little's Law, L = λW = 5,000 × 0.04 = 200 requests in flight. That number, divided by safe per-server concurrency, gives a first server count.

> [!question]- Why might a 2x peak factor be dangerous for a live-event product?
> Real peaks can be far higher. Twitter's 2013 record was about 25x its daily average. Event-driven products should size from the biggest expected event, not a generic multiplier.

> [!question]- Dean's parallel-read estimate is 18 ms, but he says "really 30–60 ms". Why the gap?
> The estimate assumes every read takes the typical time. In parallel, the page waits for the slowest of 30 reads, so variance in seek and transfer times pushes the real latency toward the tail.

## Further reading

- 🎥 [Software Engineering Advice from Building Large-Scale Distributed Systems](https://static.googleusercontent.com/media/research.google.com/en//people/jeff/stanford-295-talk.pdf) — Jeff Dean's slides with the original "numbers everyone should know" and worked estimates.
- 📝 [napkin-math](https://github.com/sirupsen/napkin-math) — current rounded numbers, techniques and practice problems.
- 🎓 [Back-of-the-envelope Estimation](https://bytebytego.com/courses/system-design-interview/back-of-the-envelope-estimation) — the interview-style QPS and storage walkthrough.
- 📝 [Latency Numbers Every Programmer Should Know (interactive)](https://colin-scott.github.io/personal_website/research/interactive_latency.html) — slide the year to see which numbers moved.
- 🔬 [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) — why averages mislead once requests fan out.

## Related

- [[Requirements (Deep Dive)]] — the user counts and SLOs that feed every estimate.
- [[Caching (Deep Dive)]] — the memory-versus-disk gap is why caches exist.
- [[Sharding (Deep Dive)]] — what to do when the storage estimate outgrows a node.
- [[Load Balancing (Deep Dive)]] — spreading peak QPS across the fleet.
- [[Cost Optimization (Deep Dive)]] — turning resource estimates into a budget.
- [[LLM Inference & Optimization (Deep Dive)]] — the same arithmetic for tokens per second and GPU memory.

> [!nav] Keep going
> ← [[Requirements (Deep Dive)|Requirements]] · [[Design Basics|💡 Design Basics]] · [[Trade-offs (Deep Dive)|Trade-offs]] →
> 🌱 Back to the basics: [[Estimation]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [napkin-math](https://github.com/sirupsen/napkin-math) — open-source project on GitHub. Article. Checked 2026-11.
[^2]: 🎓 [Back-of-the-envelope Estimation](https://bytebytego.com/courses/system-design-interview/back-of-the-envelope-estimation) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
[^3]: 📝 [Twitter: New Tweets per Second Record, and How](https://planet.mysql.com/entry/?id=258324) — Raffi Krikorian, Twitter Engineering, republished on Planet MySQL, 2013. Article. Checked 2026-11.
[^4]: 📝 [Twitter sets new tweets per second record](https://www.engadget.com/2013/08/16/twitter-sets-new-tweets-per-second-record/) — Engadget, 2013. Article. Checked 2026-11.
[^5]: 🎥 [Software Engineering Advice from Building Large-Scale Distributed Systems](https://static.googleusercontent.com/media/research.google.com/en//people/jeff/stanford-295-talk.pdf) — Jeff Dean, Google, Stanford CS295 talk slides. Talk. Checked 2026-11.
[^6]: 📖 [Little's law](https://en.wikipedia.org/wiki/Little%27s_law) — Wikipedia. Encyclopedia. Checked 2026-11.
[^7]: 🔬 [Little's Law as Viewed on Its 50th Anniversary](https://econpapers.repec.org/RePEc:inm:oropre:v:59:y:2011:i:3:p:536-549) — John D. C. Little, Operations Research, 2011 (abstract). Paper. Checked 2026-11.
[^8]: 📘 [Software Engineering in SRE](https://sre.google/sre-book/software-engineering-in-sre/) — Site Reliability Engineering, Google. Book. Checked 2026-11.
[^9]: 📝 [Latency Numbers Every Programmer Should Know (interactive)](https://colin-scott.github.io/personal_website/research/interactive_latency.html) — Colin Scott. Article. Checked 2026-11.
[^10]: 📝 [Teach Yourself Programming in Ten Years](https://norvig.com/21-days.html) — Peter Norvig, "Answers" table. Article. Checked 2026-11.
[^11]: 🔬 [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) — Dean and Barroso, Communications of the ACM, 2013. Paper. Checked 2026-11.
