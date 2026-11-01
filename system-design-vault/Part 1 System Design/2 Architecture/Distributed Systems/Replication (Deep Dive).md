---
aliases: [Replication deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/distributed-systems]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Distributed Systems]]"
basics: "[[Replication]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Distributed Systems]] › [[Replication]] › 🔬 Deep Dive

> [!tldr] For engineers
> Replication buys **durability, availability and read capacity** at the cost of **write latency or staleness**. Three topologies cover nearly every system: single-leader (log shipping plus failover), multi-leader (conflicts to resolve) and leaderless (quorums, read repair, anti-entropy). The hard parts are choosing synchronous vs asynchronous acknowledgment, electing a new leader safely, and handling the anomalies replication lag creates.

> [!basics]- New to this? Start with the basics
> [[Replication]] explains it with no jargon.

## How it really works

Abadi reduces every replication design to where an update goes first: to all replicas at once, to an agreed-upon leader, or to an arbitrary node.[^1] Each option forces a consistency/latency trade-off as soon as data is copied.[^1]

### Single-leader: shipping the log

The leader serializes all writes and streams a change log to followers. PostgreSQL streams **WAL** (write-ahead log) records as they are generated instead of waiting for a 16 MB segment to fill.[^2] MongoDB's primary records every change in the **oplog**, and secondaries replay it asynchronously.[^3] MySQL ships its **binary log**; replicas pull events when ready, so by default the source has no guarantee any event ever reaches a replica.[^4]

The acknowledgment policy is the main dial:

- **Asynchronous** (the default in all three). PostgreSQL standbys usually trail by under one second if they keep up with load.[^2] If the primary crashes, committed transactions not yet shipped are lost, in proportion to the lag at failover.[^2]
- **Semi-synchronous.** MySQL waits until at least one replica has received and logged the events (not applied them) before committing. The slowdown is at least one TCP round trip, so it suits nearby servers on fast networks.[^4] If no replica acknowledges before a timeout, it falls back to asynchronous until one catches up.[^4]
- **Synchronous / quorum commit.** PostgreSQL can wait for a set of standbys, and `remote_apply` waits until they have replayed the commit, so standby reads see it.[^2]

```ini
# postgresql.conf on the primary
synchronous_commit = on                        # or remote_write / remote_apply
synchronous_standby_names = 'ANY 2 (s1, s2, s3)'  # quorum: any two of three
```

With `ANY 2` of three, losing one standby doesn't block commits; losing two does.[^2]

### Failover and leader election

Failover has three steps: detect the dead leader, pick a successor, and redirect clients. Doing it safely is a consensus problem. **Raft** divides time into numbered **terms**, each beginning with an election; a candidate wins with votes from a majority of the cluster, and each server votes at most once per term.[^5] Randomized election timeouts (e.g., 150–300 ms) make split votes rare.[^5] A log entry is **committed** once the leader has stored it on a majority, and a five-server cluster keeps working with any two servers down.[^5]

MongoDB replica sets use the same pattern. A secondary calls an election after the primary is silent for `electionTimeoutMillis` (10 s by default), and the median time to elect a new primary should not typically exceed 12 s.[^3] Lowering the timeout detects failures faster but triggers spurious elections on transient latency, increasing rollbacks of `w: 1` writes.[^3]

### Multi-leader

Several nodes accept writes and exchange changes. PostgreSQL's logical replication can flow in multiple directions, since a publisher can also subscribe.[^6] Asynchronous multi-master tools reconcile conflicting transactions periodically, using rules or users to decide.[^6] Synchronous multi-master avoids conflicts but suffers heavy locking and commit delays under write load, so it suits mostly-read workloads; PostgreSQL does not offer it natively.[^6]

### Leaderless (Dynamo-style)

Every replica accepts writes. In Cassandra, a write goes to all replicas, and the **consistency level** sets how many acknowledgments the coordinator waits for: `ONE`, `QUORUM`, `LOCAL_QUORUM`, `ALL`.[^7] If `W + R > RF`, read and write sets overlap, so with RF=3, `QUORUM` reads and writes each need two replicas.[^7]

Dynamo adds machinery to stay writeable through failures:[^8]

- **Sloppy quorum:** operations use the first N *healthy* nodes on the preference list, not strictly the first N.
- **Hinted handoff:** a stand-in node keeps the write with a hint naming the intended owner and delivers it when the owner returns.
- **Vector clocks:** each version carries `(node, counter)` pairs so the system can tell causally ordered versions from concurrent ones.
- **Anti-entropy:** replicas compare **Merkle trees** per key range and transfer only the branches that differ.

Cassandra instead resolves conflicts per column with **last-write-wins** timestamps, which makes accurate clocks a correctness requirement.[^7]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Single-leader, async | Fast writes; simple ordering | Stale follower reads; data loss on failover |
| Single-leader, sync or quorum commit | No loss of acknowledged writes | Write latency bounded by the slowest required replica; blocks if too few replicas |
| Semi-sync | Every commit is on at least one other machine | At least one RTT per commit; falls back to async on timeout |
| Multi-leader | Local writes in each region; survives region loss | Write conflicts; complex reconciliation |
| Leaderless quorums | No failover step; tunable per request | Read repair and anti-entropy needed; LWW or merge semantics |
| Read from followers | Scales reads cheaply | Read-your-writes and monotonic-read anomalies |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| PostgreSQL async streaming lag | Typically under one second[^2] |
| MySQL semi-sync commit overhead | At least one TCP round trip to a replica[^4] |
| MongoDB election timeout / median failover | 10 s default / typically no more than 12 s[^3] |
| Raft election timeout (example range) | 150–300 ms[^5] |
| Raft fault tolerance | 5 servers tolerate 2 failures[^5] |
| Common Dynamo (N, R, W) | (3, 2, 2)[^8] |
| Dynamo 99.9th-percentile latency SLA | 300 ms at 500 requests/s peak[^8] |
| Dynamo cart reads seeing one version | 99.94%[^8] |
| GitHub 2018: unreplicated writes on one busy cluster | 954[^9] |

## Failure modes

- **Lost writes on async failover.** A leader acknowledges, crashes, and the promoted follower never saw the write. MySQL's guidance after semi-sync failover: discard the old source rather than reuse it, since it may hold unacknowledged transactions.[^4]
- **Split brain.** GitHub's 43-second partition caused Orchestrator to promote West Coast primaries while the East Coast still held writes that hadn't replicated; the site was degraded for 24 hours 11 minutes.[^9] GitHub's planned remediation: forbid promotion across regional boundaries.[^9]
- **Blocked commits.** With synchronous replication, commits can hang if a required standby crashes. Size the quorum so one loss doesn't stall writes.[^2]
- **Replication lag anomalies.** Reads from secondaries may not reflect the primary.[^3] Route a user's reads to the leader right after they write (read-your-writes), and pin sessions to one replica for monotonic reads.[^10]
- **Lag spirals.** A follower that can't keep up falls further behind. MongoDB's flow control throttles writes on the primary as lag approaches a target.[^3]
- **Clock skew under LWW.** A node with a fast clock silently wins every conflict.[^7]

## In the real world

- **GitHub** runs many MySQL clusters, with Orchestrator (built on Raft) handling topology and automated failover; its 2018 post-mortem is the standard case study of cross-region promotion going wrong.[^9]
- **Amazon RDS** combines a **synchronous** Multi-AZ standby (no reads) with **asynchronous** read replicas that serve reads and can be promoted for disaster recovery.[^11]
- **MongoDB** replica sets give automatic elections and retryable writes, which drivers enable by default.[^3]
- **Amazon Dynamo** and **Cassandra** are the reference leaderless designs.[^8][^7]
- **Vitess** shards MySQL and gives each shard its own primary plus replicas, showing how replication and [[Sharding]] combine.[^12]

## In a design interview

1. **State the goal:** "Replication here is for availability and read scaling; durability matters for orders."
2. **Topology:** "Single leader per shard, two followers in other zones."
3. **Ack policy:** "Quorum commit (any one of two followers) for orders; async read replicas for the catalog."
4. **Failover:** "Consensus-based election within a region; no automatic cross-region promotion."
5. **Lag handling:** "Read-your-writes by routing a user to the leader for a few seconds after a write."

Interviewers probe: *What happens to acknowledged writes if the leader dies?* *How do you prevent two leaders?* *How stale can a follower read be?* *Why not synchronous everywhere?*

## Check yourself

> [!question]- Why does MySQL semi-sync not guarantee zero data loss in all cases?
> It falls back to asynchronous replication when no replica acknowledges within the timeout, so commits during that window exist only on the source. It also only guarantees receipt on a replica, not that the replica applied the change.

> [!question]- Why does Raft need a majority rather than any two nodes to commit?
> Any two majorities intersect, so a newly elected leader is guaranteed to have voted with at least one server holding every committed entry. Without majority overlap, two leaders could commit conflicting entries.

> [!question]- In Dynamo, how does hinted handoff keep a write available, and what does it cost?
> If an owner is down, a healthy node accepts the write with a hint and forwards it later. The write succeeds, but until handoff completes, a read quorum may miss it, so consistency weakens during failures.

## Further reading

- 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — the leaderless design that inspired Cassandra and Riak, with production numbers.
- 🔬 [In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf) — Raft's elections and log replication, readable in an afternoon.
- 📄 [Log-Shipping Standby Servers](https://www.postgresql.org/docs/current/warm-standby.html) — exact semantics of PostgreSQL sync, quorum and `remote_apply`.
- 📄 [Semisynchronous Replication](https://dev.mysql.com/doc/refman/8.4/en/replication-semisync.html) — the clearest statement of async vs semi-sync vs sync guarantees.
- 📝 [October 21 post-incident analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) — failover, split brain and recovery told in full.

## Related

- [[CAP Theorem (Deep Dive)]] — the theory behind sync vs async and quorum choices.
- [[Sharding (Deep Dive)]] — each shard is usually its own replica set.
- [[Caching (Deep Dive)]] — another read-scaling layer with its own staleness.
- [[Fault Tolerance (Deep Dive)]] — failure detection, retries and failover.
- [[SQL Databases (Deep Dive)]] — WAL and binlog internals.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — replicating model servers and feature stores.

> [!nav] Keep going
> ← [[CAP Theorem (Deep Dive)|CAP Theorem]] · [[Distributed Systems|🕸️ Distributed Systems]] · [[Sharding (Deep Dive)|Sharding]] →
> 🌱 Back to the basics: [[Replication]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Consistency Tradeoffs in Modern Distributed Database System Design](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) — Daniel J. Abadi, IEEE Computer, 2012. Paper. Checked 2026-11.
[^2]: 📄 [Log-Shipping Standby Servers](https://www.postgresql.org/docs/current/warm-standby.html) — PostgreSQL Documentation. Official docs. Checked 2026-11.
[^3]: 📄 [Replication](https://www.mongodb.com/docs/manual/replication/) — MongoDB Manual. Official docs. Checked 2026-11.
[^4]: 📄 [Semisynchronous Replication](https://dev.mysql.com/doc/refman/8.4/en/replication-semisync.html) — MySQL 8.4 Reference Manual. Official docs. Checked 2026-11.
[^5]: 🔬 [In Search of an Understandable Consensus Algorithm (Extended Version)](https://raft.github.io/raft.pdf) — Diego Ongaro and John Ousterhout, Stanford University. Paper. Checked 2026-11.
[^6]: 📄 [Comparison of Different Solutions](https://www.postgresql.org/docs/current/different-replication-solutions.html) — PostgreSQL Documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Dynamo (Cassandra architecture)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
[^8]: 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — DeCandia et al., SOSP 2007. Paper. Checked 2026-11.
[^9]: 📝 [October 21 post-incident analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) — GitHub Blog, 2018. Engineering blog. Checked 2026-11.
[^10]: 📝 [Eventually Consistent - Revisited](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) — Werner Vogels, All Things Distributed, 2008. Article. Checked 2026-11.
[^11]: 📄 [Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html) — Amazon RDS User Guide. Official docs. Checked 2026-11.
[^12]: 📄 [Sharding](https://vitess.io/docs/reference/features/sharding/) — Vitess documentation. Official docs. Checked 2026-11.
