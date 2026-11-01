---
aliases: [CAP Theorem deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/distributed-systems]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Distributed Systems]]"
basics: "[[CAP Theorem]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Distributed Systems]] › [[CAP Theorem]] › 🔬 Deep Dive

> [!tldr] For engineers
> CAP says that in a network that can drop or delay messages, no system can implement a **linearizable** read/write register that also answers every request. It is a statement about behavior **during a partition**, not a menu of "pick two." PACELC adds the trade-off that dominates day-to-day design: even without a partition, replicated systems trade **latency against consistency**. Reason per operation and per consistency model, not with CP/AP labels.

> [!basics]- New to this? Start with the basics
> [[CAP Theorem]] explains it with no jargon.

## How it really works

### The formal statement

Gilbert and Lynch formalize CAP around a single **atomic (linearizable) read/write register**: every operation must appear to take effect at one instant between its request and response, as if one central server handled them in order.[^1] Availability means every request eventually gets a response; partition tolerance means messages between servers may be delayed or lost forever.[^1] The theorem: in a network subject to communication failures, no service can implement an atomic register that guarantees a response to every request.[^1]

The proof is short. Split the servers into `{p1}` and `{p2..pn}`. A write lands on `p1`; a read arrives at `p2`. Because every message between the halves is lost, `p2` cannot tell which value was written. It must either answer (and risk being wrong) or never answer.[^1] In an **asynchronous** network the same dilemma arises without any message loss, because a very slow message is indistinguishable from a lost one.[^1]

The paper frames this as a special case of a deeper result: you can't guarantee both **safety** (nothing bad happens, e.g. consistency) and **liveness** (something good eventually happens, e.g. availability) in an unreliable distributed system.[^1]

### What the letters really mean

The precise definitions are narrower than everyday usage:[^2]

- **C** is linearizability, a recency guarantee. It has nothing to do with the C in ACID.
- **A** requires that *every* non-failing node return a non-error response, not just "most requests succeed."
- **P** is not a design choice. Real networks drop and delay messages, so you must tolerate it.

By these definitions, many real systems are neither CP nor AP. A single-leader database with asynchronous followers is not available to clients cut off from the leader, and follower reads are not linearizable. Dynamo-style stores move between the two depending on quorum settings.[^2] Linearizability in particular cannot be totally or sticky available: during a partition, some or all nodes must stop making progress.[^3]

### Brewer's revision: manage the partition

Brewer, who proposed CAP in a PODC 2000 keynote, wrote in 2012 that the "2 of 3" formulation was always misleading.[^4] Partitions are rare, so there is little reason to give up C or A when the network is healthy.[^4] He recommends three steps: **detect** the partition, enter an explicit **partition mode** that limits some operations, then **recover** by restoring consistency and compensating for mistakes.[^4] ATMs illustrate this: during a partition they keep dispensing cash but cap withdrawals to bound the risk.[^4] He also ties CAP to latency: a partition is effectively a time bound on communication, and a timeout is where the C-versus-A decision is made.[^4]

### PACELC: the trade-off you pay every day

Abadi rewrites CAP as **PACELC**: if there is a **P**artition, trade **A**vailability against **C**onsistency; **E**lse, trade **L**atency against **C**onsistency.[^5] The second half exists because availability requires replication, and replication forces a choice: wait for remote replicas (slow, consistent) or answer before they confirm (fast, possibly stale).[^5] Over a wide-area network "there is no way around" that trade-off.[^5]

| System (defaults, per Abadi 2012) | Partition | Else |
| --- | --- | --- |
| Dynamo, Cassandra, Riak | PA | EL |
| VoltDB/H-Store, Megastore, BigTable, HBase | PC | EC |
| MongoDB | PA | EC |
| Yahoo PNUTS | PC | EL |

These are 2012 defaults; most systems now expose knobs that move them.[^5] MongoDB shows why labels mislead: Abadi files it under PA/EC, while Wikipedia lists it as consistency-favoring under partition.[^5][^6]

### The consistency spectrum

Between linearizable and "anything goes" sit models with different availability.[^7]

```text
Cannot be totally available : strict serializable, linearizable, serializable, sequential, snapshot isolation
At most sticky available    : causal, PRAM, read-your-writes
Can be totally available    : weaker models such as read committed
```

Vogels lists the session guarantees that make eventual consistency usable: **read-your-writes**, **session consistency** and **monotonic reads**.[^8] In quorum systems with `N` replicas, a write acknowledged by `W` replicas and a read from `R` replicas are guaranteed to overlap when `W + R > N`.[^8] Abadi notes that overlap alone still falls short of Gilbert–Lynch linearizability in Dynamo-style systems.[^5]

## Design choices and trade-offs

| Choice | Gains | Costs | Fits |
| --- | --- | --- | --- |
| Refuse on the minority side (CP behavior) | No divergent writes, no reconciliation | Errors or timeouts for cut-off clients | Balances, inventory, locks, leader election |
| Accept everywhere (AP behavior) | Every client can write | Conflicts to merge after healing | Carts, likes, presence, metrics |
| Synchronous replication when healthy (EC) | Fresh reads anywhere | Write latency bounded by slowest replica | Small-radius clusters, financial records |
| Asynchronous replication when healthy (EL) | Low latency, local reads | Stale reads; possible loss on failover | Global read-heavy apps |
| Per-request choice | Pay for strength only where needed | More complex client logic | Mixed workloads (e.g., DynamoDB `ConsistentRead`) |
| Partition mode with limits | Stay up with bounded risk | Must design compensations | ATMs, bookings with overbooking rules |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Spanner availability | More than five 9s; network caused under 10% of its outages[^9] |
| DynamoDB eventually consistent read cost | Half of a strongly consistent read[^10] |
| DynamoDB global tables (eventual mode) replication | Typically within a second[^10] |
| Cassandra quorum reads vs weak reads | Latency difference of a factor of four or more[^5] |
| GitHub 2018 partition | 43 s of lost connectivity led to 24 h 11 min of degraded service[^11] |
| Dynamo shopping cart reads seeing exactly one version | 99.94% over 24 hours[^12] |

## Failure modes

- **Split brain.** Both sides of a partition accept writes and diverge. GitHub's 43-second partition left both coasts with writes the other lacked; one busy cluster had 954 unreplicated writes to reconcile by hand.[^11] GitHub's planned remediation was to stop promoting primaries across regions.[^11] Majority quorums and fencing also help.
- **Timeouts that guess wrong.** A slow link looks like a partition, so a node may give up consistency for nothing.[^1] Tune timeouts to measured latency and treat them as the CAP decision point.[^4]
- **Resurrected data.** Merging divergent copies by union keeps every addition but can bring back deleted items, as in Amazon's cart.[^4] Use richer merge rules or tombstones.
- **Lost updates under last-write-wins.** Cassandra resolves conflicts by timestamp, which requires accurate clocks; skew silently drops the "losing" write.[^13]
- **Stale reads mistaken for bugs.** Default eventually consistent reads may miss a write that just succeeded.[^10] Use read-your-writes routing or strong reads on the paths that need them.

## In the real world

- **Google Spanner** is "technically CP" yet claims availability high enough to treat it as CA, because it runs on Google's private, redundant network.[^9]
- **Amazon Dynamo** chose an "always writeable" design and pushes conflict resolution to reads and the application.[^12]
- **Amazon DynamoDB** exposes the PACELC "else" choice per request through `ConsistentRead`, and offers multi-region strong consistency (MRSC) as a global table mode.[^10]
- **Cassandra** offers tunable consistency levels from `ONE` to `ALL`, with `QUORUM` reads and writes overlapping when `W + R > RF`.[^13]
- **GitHub** chose data integrity over availability during its 2018 incident.[^11]

## In a design interview

Never say "it's AP" and stop. Show you know CAP only applies during a partition, then decide per operation:

1. **Classify data:** "Payments and inventory must be linearizable; the feed and like counts can be eventually consistent."
2. **Partition behavior:** "If a region is cut off, it rejects payment writes but keeps serving the feed from local replicas."
3. **Normal-case latency (PACELC):** "Feed reads are local and async-replicated; payment writes wait for a majority quorum."
4. **Recovery:** "On healing, feed replicas converge via anti-entropy; alert on reconciliation backlog."

Interviewers probe: *What exactly does "consistent" mean here?* (Name the model.) *What does a user on the minority side see?* *How do you merge conflicts?* *What does strong consistency cost in latency?*

## Check yourself

> [!question]- Why can't you "choose CA" for a multi-node system?
> Because partitions are something the network does to you, not a feature you opt out of. When one happens, the system must either stop answering on some nodes or risk answering wrongly. "CA" only describes behavior when no partition exists.

> [!question]- A Dynamo-style store runs with N=3, W=2, R=2. Is it linearizable?
> Not guaranteed. W + R > N makes read and write sets overlap, but with sloppy quorums, concurrent writes and conflict resolution it still falls short of linearizability.

> [!question]- Why does Abadi argue latency, not CAP, explains most systems' weak consistency?
> PNUTS gives up consistency in normal operation yet becomes unavailable for writes under partition, so its weak consistency can't be a CAP choice. The constant cost of synchronous replication, especially over a WAN, is the better explanation.

## Further reading

- 🔬 [Perspectives on the CAP Theorem](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf) — the theorem and its proof from the people who proved it, plus coping strategies.
- 📝 [CAP Twelve Years Later](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/) — Brewer's own correction of the "2 of 3" myth and his partition-recovery playbook.
- 🔬 [Consistency Tradeoffs in Modern Distributed Database System Design](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) — the PACELC paper, with clear replication-option taxonomy.
- 📝 [Please stop calling databases CP or AP](https://martin.kleppmann.com/2015/05/11/please-stop-calling-databases-cp-or-ap.html) — why the labels fail real systems.
- 📄 [Consistency models](https://jepsen.io/consistency/models) — Jepsen's map of models and which ones can stay available.

## Related

- [[Replication (Deep Dive)]] — synchronous vs asynchronous replication is where PACELC's "else" lives.
- [[Sharding (Deep Dive)]] — per-shard quorums and cross-shard consistency.
- [[NoSQL Databases (Deep Dive)]] — Dynamo-style stores and tunable consistency.
- [[Fault Tolerance (Deep Dive)]] — timeouts, failure detection and recovery.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — the same trade-offs in distributed AI platforms.

> [!nav] Keep going
> ← [[Object Storage (Deep Dive)|Object Storage]] · [[Distributed Systems|🕸️ Distributed Systems]] · [[Replication (Deep Dive)|Replication]] →
> 🌱 Back to the basics: [[CAP Theorem]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Perspectives on the CAP Theorem](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf) — Seth Gilbert and Nancy Lynch, IEEE Computer, 2012. Paper. Checked 2026-11.
[^2]: 📝 [Please stop calling databases CP or AP](https://martin.kleppmann.com/2015/05/11/please-stop-calling-databases-cp-or-ap.html) — Martin Kleppmann, 2015. Article. Checked 2026-11.
[^3]: 📄 [Linearizability](https://jepsen.io/consistency/models/linearizable) — Jepsen. Reference. Checked 2026-11.
[^4]: 📝 [CAP Twelve Years Later: How the "Rules" Have Changed](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/) — Eric Brewer, InfoQ (from IEEE Computer), 2012. Article. Checked 2026-11.
[^5]: 🔬 [Consistency Tradeoffs in Modern Distributed Database System Design](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) — Daniel J. Abadi, IEEE Computer, 2012. Paper. Checked 2026-11.
[^6]: 📖 [CAP theorem](https://en.wikipedia.org/wiki/CAP_theorem) — Wikipedia. Encyclopedia. Checked 2026-11.
[^7]: 📄 [Consistency models](https://jepsen.io/consistency/models) — Jepsen. Reference. Checked 2026-11.
[^8]: 📝 [Eventually Consistent - Revisited](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) — Werner Vogels, All Things Distributed, 2008. Article. Checked 2026-11.
[^9]: 📝 [Inside Cloud Spanner and the CAP Theorem](https://cloud.google.com/blog/products/databases/inside-cloud-spanner-and-the-cap-theorem) — Eric Brewer, Google Cloud Blog, 2017. Engineering blog. Checked 2026-11.
[^10]: 📄 [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^11]: 📝 [October 21 post-incident analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) — GitHub Blog, 2018. Engineering blog. Checked 2026-11.
[^12]: 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — DeCandia et al., SOSP 2007. Paper. Checked 2026-11.
[^13]: 📄 [Dynamo (Cassandra architecture)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
