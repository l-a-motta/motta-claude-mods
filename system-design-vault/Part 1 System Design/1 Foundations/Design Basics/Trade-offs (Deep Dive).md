---
aliases: [Trade-offs deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/design-basics]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Design Basics]]"
basics: "[[Trade-offs]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Design Basics]] › [[Trade-offs]] › 🔬 Deep Dive

> [!tldr] For engineers
> System design is constrained optimization: every mechanism buys one property with another. The recurring axes are **consistency vs availability** under partition (CAP), **consistency vs latency** the rest of the time (PACELC), **latency vs throughput** (batching, hedging), **durability vs speed**, and **cost vs reliability**. Strong designs choose per operation, tie each choice to a stated requirement, prefer reversible decisions, and record the rationale.

> [!basics]- New to this? Start with the basics
> [[Trade-offs]] explains it with no jargon.

## How it really works

### Requirements decide, not taste

A trade-off only has a right answer relative to requirements. AWS's Well-Architected Framework says teams trade between its pillars (operational excellence, security, reliability, performance efficiency, cost optimization, sustainability) based on business context: cheaper, less reliable development environments; costlier, more reliable mission-critical systems. Security and operational excellence are generally not traded away.[^1] Jeff Dean's version: the "best" solution might mean simplest, highest-performing or easiest to extend, and the core skill is estimating which design wins before building it.[^2]

### Consistency vs availability: CAP, read properly

CAP says a networked shared-data system can have at most two of consistency, availability and partition tolerance.[^3] Brewer himself calls the "two of three" framing misleading:[^3]

- Partitions are rare; when there is no partition, there is no reason to give up C or A.
- The choice can be made per subsystem, per operation or per data item, not once per system.
- Each property is a spectrum: availability runs from 0 to 100%, and there are many consistency levels.
- A partition is effectively a **time bound on communication**: when a reply doesn't arrive in time, the system must either answer (sacrificing C) or wait or fail (sacrificing A).
- The practical playbook is to detect partitions, enter an explicit partition mode that may restrict some operations, then run recovery to restore consistency and compensate for mistakes.

Vogels gives the consistency vocabulary: **strong** (every later read sees the update), **weak** (no guarantee), and **eventual** (absent new updates, all reads converge), with an **inconsistency window** between write and convergence.[^4] Replicated stores often expose the trade as quorum sizes:[^4]

```text
N = replicas, W = acks per write, R = replicas read
W + R >  N  -> read and write sets overlap: strongly consistent reads
W + R <= N  -> a read may miss the latest write: eventual consistency
e.g. N=3, W=2, R=2 (consistent)   vs   N=3, W=1, R=1 (fast, eventual)
```

Weaker models can still give users sane behavior: **read-your-writes** and **session consistency** guarantee a client sees its own updates.[^4]

### Consistency vs latency: PACELC

Abadi's 2010 refinement asks two questions: if there is a Partition, how does the system trade Availability against Consistency; Else, in normal operation, how does it trade Latency against Consistency?[^5] He classes Dynamo, Cassandra and SimpleDB as PA/EL, fully ACID systems as PC/EC, and Yahoo's PNUTS as PC/EL.[^5] His 2012 paper argues that CAP's impact is more limited than often perceived, and that the latency/consistency trade-off has had a more direct influence on several well-known distributed databases.[^6]

DynamoDB makes the E-side choice a per-request flag. Reads are eventually consistent by default; `ConsistentRead=true` returns the latest committed data, costs twice as much, and is unavailable on global secondary indexes and streams.[^7] Across regions, global tables default to asynchronous replication (typically within a second) or can replicate synchronously to another region before acknowledging a write.[^7]

### Latency vs throughput

**Batching** amortizes per-request overhead at the cost of waiting. Confluent's tuning guide for Kafka producers raises `batch.size` from its 16,384-byte default to 100,000–200,000 and `linger.ms` from 5 to 10–100, explicitly accepting higher latency for throughput.[^8]

```properties
# throughput-optimized producer
batch.size=200000
linger.ms=50
```

**Hedged requests** go the other way: spend extra load to cut tail latency. Send a backup request to another replica if the first hasn't answered after a short delay, and take whichever wins.[^9] Naive versions add unacceptable load, but waiting until the 95th-percentile expected latency caps the extra load at about 5%.[^9]

### Durability vs speed

Dynamo let nodes acknowledge writes from an in-memory buffer, flushed later by a writer thread. That cut 99.9th-percentile latency by a factor of five during peak traffic, but a crash could lose buffered writes. Amazon narrowed the risk by having one of the N replicas perform a durable write, off the critical path.[^10]

### Cost vs reliability

Google's SRE book observes that an incremental improvement in reliability may cost 100x more than the previous one, and that engineers spent on reliability are not building features.[^11] It also prices the trade explicitly: for Bigtable, throughput-oriented clusters can cost as little as 10–50% of low-latency clusters.[^11]

### Reversibility and recording decisions

Not every trade-off deserves the same rigor. Bezos separates **Type 1** decisions (one-way doors, nearly irreversible, to be made slowly) from **Type 2** (two-way doors, reversible, to be made fast by small groups), and warns that applying Type 1 process to everything breeds slowness and risk aversion.[^12] For decisions that stick, Michael Nygard's **architecture decision records** capture title, context, decision, status and consequences, including the negative ones, so later engineers neither blindly accept nor blindly reverse them.[^13]

## Design choices and trade-offs

| Axis | Option A | Option B | Pick A when | Pick B when |
| --- | --- | --- | --- | --- |
| Under partition | Consistency (refuse or wait) | Availability (answer, reconcile later) | Money, inventory, uniqueness | Carts, feeds, likes, telemetry[^3][^10] |
| Normal operation | Consistency (sync replicas, quorum reads) | Latency (local or async reads) | Users must read their own writes | Slight staleness is invisible[^5][^7] |
| Request handling | Low latency (send immediately) | High throughput (batch) | Interactive paths with tight SLOs | Pipelines, logs, analytics[^8] |
| Tail latency | Hedge or replicate requests | Single request | p99.9 of a fan-out matters | Load headroom is scarce[^9] |
| Write acknowledgment | Durable (fsync, replica acks) | Buffered | Data loss is unacceptable | Losing a few writes is tolerable[^10] |
| Reliability target | Extra nine | Faster feature delivery | Enterprise or revenue-critical | Early product, cheap retries[^11] |
| Decision process | Deliberate (Type 1) | Fast (Type 2) | Hard to reverse | Easy to undo[^12] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| DynamoDB eventually consistent read cost | Half a strongly consistent read[^7] |
| DynamoDB global tables, default replication lag | Typically within a second[^7] |
| Hedged request after 10 ms, BigTable 1,000-key read over 100 servers | p99.9 from 1,800 ms to 74 ms with 2% more requests[^9] |
| Dynamo write buffering (1,000-object buffer) | 5x lower p99.9 write latency at peak[^10] |
| Dynamo cart requests that saw exactly one version | 99.94%[^10] |
| Kafka producer defaults vs throughput tuning | `batch.size` 16,384 → 100,000–200,000; `linger.ms` 5 → 10–100[^8] |
| Cost of each extra reliability increment | May be 100x the previous one[^11] |
| Bigtable throughput vs low-latency cluster cost | 10–50%[^11] |

## Failure modes

- **Hidden trade-offs.** Choosing eventual consistency without telling product owners leads to "I saved it and it vanished" bugs. Defend with read-your-writes or session guarantees on the paths users notice.[^4] Dynamo improved read-your-writes odds by picking the write coordinator that answered the preceding read fastest.[^10]
- **Merge anomalies.** Availability-first designs must reconcile divergent versions; Dynamo's cart merge never loses an add, but deleted items can resurface.[^10] Make reconciliation rules explicit and acceptable to the business.
- **CAP as a global switch.** Labeling a whole system "CP" or "AP" ignores that the choice can and should vary per operation.[^3]
- **Throughput tuning that breaks an SLO.** A large `linger.ms` on an interactive path adds its full delay to every message.[^8]
- **Naive hedging.** Duplicating every request doubles load and can cause the overload it was meant to hide; delay the hedge until the 95th-percentile latency.[^9]
- **Buffered writes without a durable copy.** A crash loses acknowledged data; keep at least one durable replica in the write path.[^10]
- **Heavyweight process everywhere.** Treating reversible choices as one-way doors slows teams down.[^12]
- **Lost rationale.** Without a recorded decision, the next team reverses a good trade-off or keeps a bad one.[^13]

## In the real world

- **Amazon Dynamo** chose always-writeable over consistent, pushing conflict resolution to reads and to the application (merge carts) instead of "last write wins".[^10]
- **Amazon DynamoDB** exposes consistency per request and per global table.[^7]
- **Yahoo PNUTS** keeps a user's master copy nearby and replicates asynchronously for latency; **Facebook** pins a user's reads to the master for a short time after their own update, per Brewer.[^3]
- **Google** uses hedged requests to tame tail latency at modest cost.[^9]
- **Kafka producers** expose the latency/throughput knob directly through batching.[^8]

## In a design interview

Give every major choice the same four-part shape:

1. **Decision:** "Feed reads are eventually consistent from replicas."
2. **Because:** "Requirement: p99 < 300 ms; a post may take seconds to show."
3. **Cost:** "A user might not see their own post on refresh."
4. **Mitigation and trigger to revisit:** "Read-your-writes by routing the author to the primary for a minute; revisit if we add comment threads that need ordering."

Interviewers probe: *What happens during a partition?* *Which operations need strong consistency?* (Payments, inventory, unique usernames.) *How would you cut p99?* (Hedging, caching, fewer hops.) *What did you give up and is it reversible?* Avoid absolute claims; Brewer's point is that the space between pure C and pure A is where real systems live.[^3]

## Check yourself

> [!question]- With N = 3 replicas, which (W, R) settings give strongly consistent reads, and what do you pay for them?
> Any setting with W + R > 3, such as (2, 2), (3, 1) or (1, 3). You pay in latency (waiting for more acks or replies) and in availability, since the operation fails if too few replicas respond.

> [!question]- Why does PACELC matter even in a datacenter that never partitions?
> Because the latency/consistency trade-off exists in normal operation: synchronous replication or quorum reads add round trips to every request, while async replication is faster but stale. Partitions are rare; that cost is constant.

> [!question]- A fan-out service's p99.9 is 1.8 s. Hedging would fix it. What keeps hedging from making things worse?
> Delay the hedge until the request has exceeded roughly its 95th-percentile expected latency, so only a few percent of requests are duplicated; cancel the loser, and optionally send hedges at lower priority.

## Further reading

- 📝 [CAP Twelve Years Later](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/) — Brewer's own correction of how CAP is usually taught.
- 📝 [Eventually Consistent](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) — Vogels's clear map of consistency models and quorum math.
- 📝 [Problems with CAP, and Yahoo's little known NoSQL system](https://dbmsmusings.blogspot.com/2010/04/problems-with-cap-and-yahoos-little.html) — where PACELC was first proposed.
- 🔬 [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) — trading resources for predictable latency.
- 📝 [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the short post that introduced ADRs.

## Related

- [[CAP Theorem (Deep Dive)]] — the formal result behind the consistency/availability axis.
- [[Replication (Deep Dive)]] — sync vs async replication and quorums in depth.
- [[Caching (Deep Dive)]] — trading freshness for latency.
- [[Message Queues (Deep Dive)]] — trading immediacy for throughput and resilience.
- [[Requirements (Deep Dive)]] — the SLOs that settle each trade-off.
- [[Cost Optimization (Deep Dive)]] — cost/quality trade-offs in AI systems.

> [!nav] Keep going
> ← [[Estimation (Deep Dive)|Estimation]] · [[Design Basics|💡 Design Basics]] · [[Monoliths (Deep Dive)|Monoliths]] →
> 🌱 Back to the basics: [[Trade-offs]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Definitions](https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html) — AWS Well-Architected Framework. Official docs. Checked 2026-11.
[^2]: 🎥 [Software Engineering Advice from Building Large-Scale Distributed Systems](https://static.googleusercontent.com/media/research.google.com/en//people/jeff/stanford-295-talk.pdf) — Jeff Dean, Google, Stanford CS295 talk slides. Talk. Checked 2026-11.
[^3]: 📝 [CAP Twelve Years Later: How the "Rules" Have Changed](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/) — Eric Brewer, InfoQ. Article. Checked 2026-11.
[^4]: 📝 [Eventually Consistent](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) — Werner Vogels, All Things Distributed, 2008. Article. Checked 2026-11.
[^5]: 📝 [Problems with CAP, and Yahoo's little known NoSQL system](https://dbmsmusings.blogspot.com/2010/04/problems-with-cap-and-yahoos-little.html) — Daniel Abadi, DBMS Musings, 2010. Article. Checked 2026-11.
[^6]: 🔬 [Consistency Tradeoffs in Modern Distributed Database System Design](https://www.odbms.org/2012/01/consistency-tradeoffs-in-modern-distributed-database-system-design/) — Daniel Abadi, IEEE Computer, February 2012 (abstract on ODBMS.org). Paper. Checked 2026-11.
[^7]: 📄 [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^8]: 📄 [Optimize Confluent Cloud Clients for Throughput](https://docs.confluent.io/cloud/current/client-apps/optimizing/throughput.html) — Confluent documentation. Official docs. Checked 2026-11.
[^9]: 🔬 [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) — Dean and Barroso, Communications of the ACM, 2013. Paper. Checked 2026-11.
[^10]: 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — DeCandia et al., SOSP 2007, sections 2.3, 4.4 and 6.1–6.3. Paper. Checked 2026-11.
[^11]: 📘 [Embracing Risk](https://sre.google/sre-book/embracing-risk/) — Site Reliability Engineering, Google. Book. Checked 2026-11.
[^12]: 📄 [2015 Letter to Shareholders](https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm) — Jeff Bezos, Amazon.com, SEC filing. Official docs. Checked 2026-11.
[^13]: 📝 [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — Michael Nygard, Cognitect, 2011. Article. Checked 2026-11.
