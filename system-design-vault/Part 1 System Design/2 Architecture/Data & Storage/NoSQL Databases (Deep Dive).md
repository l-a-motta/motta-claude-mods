---
aliases: [NoSQL Databases deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/data-and-storage]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Data & Storage]]"
basics: "[[NoSQL Databases]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Data & Storage]] › [[NoSQL Databases]] › 🔬 Deep Dive

> [!tldr] For engineers
> "NoSQL" is a family, not a feature: key-value, document, wide-column and graph stores. Most of them **partition by a hashed key**, **replicate with tunable consistency**, and **model data around known access patterns** instead of normalizing and joining. You gain horizontal scale and predictable latency; you pay with denormalization, hot partitions, limited cross-item transactions and weak support for ad-hoc queries.

> [!basics]- New to this? Start with the basics
> [[NoSQL Databases]] explains it with no jargon.

## How it really works

### Where it came from

NoSQL databases are purpose-built for specific data models with flexible schemas, and most relax some ACID properties in exchange for partitionability.[^1] Martin Fowler traces the name to a June 2009 meetup in San Francisco featuring Voldemort, Cassandra, Dynomite, HBase, Hypertable, CouchDB and MongoDB; their common traits were no relational model, running on clusters and being schemaless, though "none are definitional".[^2]

The intellectual root is Amazon's **Dynamo** paper (SOSP 2007). Amazon needed an "always writeable" store so shopping-cart updates would never be rejected during failures. Dynamo combined consistent hashing with virtual nodes, vector clocks for versioning, a sloppy quorum with hinted handoff, gossip-based membership and Merkle-tree anti-entropy, and it was explicitly "an eventually consistent data store".[^3] Its SLA was measured at the 99.9th percentile, for example 300 ms.[^3]

### Partitioning by key

The partition key is hashed, and the hash picks the physical partition. In DynamoDB a **composite key** adds a sort key: all items with the same partition key are stored together, sorted by sort key, so you can fetch one item or a range within a partition in one request.[^4] Cassandra places nodes on a **token ring** with consistent hashing and assigns each physical node many tokens (vnodes) so data and load spread evenly when nodes join or leave.[^5]

### Replication and tunable consistency

Cassandra keeps **RF** copies of each partition and lets every request choose how many replicas must answer: `ONE`, `QUORUM` (n/2 + 1), `ALL`, or `LOCAL_QUORUM` within one datacenter.[^5] With `QUORUM` writes and `QUORUM` reads, at least one replica is in both sets, so reads see the latest acknowledged write (the general rule is R + W > RF).[^5] Conflicts resolve by **last write wins** on timestamps, which is why clocks must be synchronized with NTP; hinted handoff and read repair help replicas converge.[^5]

### Query-first modeling

Wide-column modeling starts from the queries, not the entities. Cassandra has no joins, so each query is served by one table holding every column it needs, and data is deliberately duplicated across tables.[^6] The partition key decides placement; clustering columns sort rows inside the partition.[^6] An illustrative message table, shaped like Discord's channel-plus-time-bucket design:

```sql
CREATE TABLE messages (
  channel_id bigint,
  bucket     int,        -- fixed time window, bounds partition size
  message_id bigint,
  author_id  bigint,
  content    text,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

Document stores follow the same instinct: "data that's accessed together should be stored together."[^7] You **embed** related data to avoid joins, or **reference** it in a separate collection when it is large or rarely read.[^7] Embedding is bounded by the 16 MiB BSON document limit and 100 levels of nesting.[^8] A single-document write is atomic; multi-document transactions exist (replica sets since 4.0, sharded clusters since 4.2) but cost more and "should not be a replacement for effective schema design".[^9]

### Graphs

Graph databases store nodes, typed and directed relationships, and properties on both. Neo4j stores relationships natively rather than computing JOINs, so traversing many hops stays fast.[^10] They fit social and road networks, deep hierarchies and hidden connections between distant items, where the question is about paths, not rows.[^10]

### DynamoDB capacity math

One read unit is one strongly consistent read per second (or two eventually consistent ones) of up to 4 KB; one write unit is one write per second of up to 1 KB.[^11] Each partition tops out at **3,000 read units and 1,000 write units per second**, so a 20 KB item read strongly consistently costs 5 units, and one hot key can serve only 600 such reads per second.[^11] Transactional reads and writes cost double.[^12]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Key-value (DynamoDB) | Predictable single-digit ms at any scale | Only key and index lookups; model every access pattern up front |
| Document (MongoDB) | Natural fit for nested objects; flexible fields | Large or unbounded embedded arrays; cross-document work costs more |
| Wide-column (Cassandra) | Very high write throughput; multi-datacenter | No joins; one table per query; duplicated data |
| Graph (Neo4j) | Fast multi-hop traversals | Harder to scale out; niche for non-graph workloads |
| Embed vs reference | Embed: one read, atomic update | Embed: document growth; reference: extra round trips |
| `ONE` vs `QUORUM` | `ONE`: lowest latency, highest availability | `ONE`: stale reads possible |
| Eventually vs strongly consistent reads | Half the read cost in DynamoDB[^11] | May miss the latest write |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| DynamoDB max item size | 400 KB[^12] |
| DynamoDB per-partition throughput | 3,000 reads/s, 1,000 writes/s (unit-sized)[^11] |
| DynamoDB transaction | Up to 100 items, 4 MB[^12] |
| DynamoDB `Query`/`Scan` page | 1 MB per call[^12] |
| DynamoDB vector indexes | 5 per table by default; up to 4,096 dimensions[^13] |
| MongoDB max document | 16 MiB, 100 nesting levels[^8] |
| DynamoDB peak, Prime Day 2025 | 151M requests/s[^14] |
| DynamoDB, Prime Day 2026 | 192M requests/s peak; 59+ trillion requests over four days[^15] |
| Discord messages cluster | 12 nodes (2017) → 177 Cassandra nodes (2022) → 72 ScyllaDB nodes[^16] |
| Discord p99 history fetch | 40–125 ms on Cassandra → 15 ms on ScyllaDB[^16] |
| Dynamo SLA example | 300 ms at the 99.9th percentile[^3] |

## Failure modes

- **Hot partitions.** Traffic concentrates on one key (a celebrity, a busy channel) and exceeds per-partition limits.[^11] At Discord a hot partition "frequently affected latency across our entire database cluster".[^16] Defend with high-cardinality keys, write sharding (suffixing keys), caching, and request coalescing.
- **Unbounded partitions.** Appending forever to one partition key makes it huge. Discord adds a static time **bucket** to the key.[^16] In DynamoDB, a table with local secondary indexes caps each item collection at 10 GB.[^12]
- **Stale or lost updates.** Eventual consistency means reads can trail writes; last-write-wins silently drops a concurrent update and depends on synchronized clocks.[^5] Use quorum reads where it matters and conditional writes for read-modify-write.
- **Cross-region transactions.** DynamoDB transactions are ACID only in the Region where they were written; other replicas of a global table can briefly show partial results.[^12]
- **Operational drag.** Discord's Cassandra cluster suffered garbage-collection pauses that spiked latency and fell behind on compactions.[^16]
- **The accidental scan.** A query the model didn't plan for becomes a full scan, paged 1 MB at a time.[^12] Add an index or a new table, not a scan.

## In the real world

- **Amazon** built Dynamo for the shopping cart; DynamoDB now serves Prime Day at up to 192 million requests per second with single-digit-millisecond responses.[^3][^15]
- **Discord** partitions messages by channel and time bucket with three replicas, and migrated trillions of messages from Cassandra to ScyllaDB at up to 3.2 million messages per second, fronted by Rust data services with roughly one gRPC endpoint per query.[^16]
- **MongoDB** pushes embedding first and transactions second.[^7][^9]
- **Neo4j** is used for connected-data problems across financial services, retail, government and more.[^10]

## In a design interview

Choose NoSQL when access patterns are **few, known and massive**: sessions, carts, feeds, chat history, IoT time series. Then design keys, not tables.

1. **List access patterns:** "Get the latest 50 messages in a channel; post a message."
2. **Choose keys:** "Partition key `(channel_id, bucket)`, sort key `message_id` descending; buckets keep partitions bounded."
3. **Consistency:** "Writes at `LOCAL_QUORUM`, reads at `LOCAL_QUORUM`; RF 3 per datacenter."
4. **Hot keys:** "Cache the hottest channels; shard keys if a partition nears its limit."

Interviewers probe: *How do you query by author?* (Second table or global secondary index.) *What if two users edit the same item?* (Conditional writes or a version attribute.) *Why not Postgres?* (Fine until writes or data outgrow one primary, or the access pattern is pure key lookup at huge scale.)

## Check yourself

> [!question]- With RF = 3, why do QUORUM writes plus QUORUM reads return the latest acknowledged write?
> A quorum is 2 of 3 replicas. Any two sets of 2 out of 3 overlap in at least one replica, so the read always touches a replica that has the write (R + W = 4 > 3).

> [!question]- Your DynamoDB items are 20 KB and one item gets 1,000 strongly consistent reads per second. What happens?
> Each read costs 5 read units, so the item needs 5,000 units per second, beyond the 3,000-unit partition limit. Expect throttling; add a cache, use eventually consistent reads, or shrink the item.

> [!question]- Why does Discord put a time bucket in its partition key?
> To bound partition size. Without it, a busy channel's partition would grow forever, hurting compaction and read latency. The bucket starts a fresh partition each time window.

## Further reading

- 🔬 [Amazon's Dynamo](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html) — the paper that defined the leaderless, eventually consistent key-value design.
- 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — a candid production story of hot partitions, GC pauses and a big migration.
- 📄 [Dynamo architecture in Cassandra](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) — token rings, vnodes and consistency levels explained by the project.
- 📄 [Partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — the per-partition limits and how to stay under them.
- 📄 [MongoDB data modeling](https://www.mongodb.com/docs/manual/data-modeling/) — embedding versus referencing, from the source.

## Related

- [[SQL Databases (Deep Dive)]] — MVCC, joins and the single-primary alternative.
- [[Sharding (Deep Dive)]] — consistent hashing and rebalancing.
- [[CAP Theorem (Deep Dive)]] — availability versus consistency under partition.
- [[Replication (Deep Dive)]] — leaderless quorums versus leader-follower.
- [[Caching (Deep Dive)]] — shielding hot keys.
- [[Embeddings & Vector Databases (Deep Dive)]] — vector search, now also built into key-value stores.

> [!nav] Keep going
> ← [[SQL Databases (Deep Dive)|SQL Databases]] · [[Data & Storage|🗄️ Data & Storage]] · [[Object Storage (Deep Dive)|Object Storage]] →
> 🌱 Back to the basics: [[NoSQL Databases]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [What is NoSQL?](https://aws.amazon.com/nosql/) — Amazon Web Services. Official docs. Checked 2026-11.
[^2]: 📝 [NosqlDefinition](https://martinfowler.com/bliki/NosqlDefinition.html) — Martin Fowler. Article. Checked 2026-11.
[^3]: 🔬 [Amazon's Dynamo](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html) — Werner Vogels, All Things Distributed (SOSP 2007 paper). Paper. Checked 2026-11.
[^4]: 📄 [Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^5]: 📄 [Dynamo](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) — Apache Cassandra documentation, Architecture. Official docs. Checked 2026-11.
[^6]: 📄 [Introduction to data modeling](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/intro.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Data Modeling](https://www.mongodb.com/docs/manual/data-modeling/) — MongoDB documentation. Official docs. Checked 2026-11.
[^8]: 📄 [MongoDB Limits and Thresholds](https://www.mongodb.com/docs/manual/reference/limits/) — MongoDB documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Transactions](https://www.mongodb.com/docs/manual/core/transactions/) — MongoDB documentation. Official docs. Checked 2026-11.
[^10]: 📄 [What is a graph database](https://neo4j.com/docs/getting-started/graph-database/) — Neo4j documentation. Official docs. Checked 2026-11.
[^11]: 📄 [Best practices for designing and using partition keys effectively](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^12]: 📄 [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^13]: 📄 [Quotas in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^14]: 📝 [AWS services scale to new heights for Prime Day 2025](https://aws.amazon.com/blogs/aws/aws-services-scale-to-new-heights-for-prime-day-2025-key-metrics-and-milestones/) — AWS News Blog, 2025. Engineering blog. Checked 2026-11.
[^15]: 📝 [All the numbers: Amazon Prime Day 2026 powered by AWS](https://aws.amazon.com/blogs/aws/all-the-numbers-amazon-prime-day-2026-powered-by-aws/) — AWS News Blog, 2026. Engineering blog. Checked 2026-11.
[^16]: 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — Discord Engineering. Engineering blog. Checked 2026-11.
