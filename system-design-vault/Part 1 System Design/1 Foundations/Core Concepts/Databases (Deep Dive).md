---
aliases: [Databases deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/core-concepts]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Core Concepts]]"
basics: "[[Databases]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Core Concepts]] › [[Databases]] › 🔬 Deep Dive

> [!tldr] For engineers
> A database engine is four parts: a **storage structure** (usually a B-tree or an LSM tree), a **log** that makes commits durable, **concurrency control** that decides which anomalies concurrent transactions can see, and a **query planner** that turns SQL into index and table access. Picking a database means picking a read/write amplification profile, an isolation level, and a plan for when one node is no longer enough.

> [!basics]- New to this? Start with the basics
> [[Databases]] explains it with no jargon.

## How it really works

### Pages and storage structures

PostgreSQL stores every table and index as an array of fixed-size **pages**, usually 8 kB.[^1] Everything above, from indexes to caches to the WAL, is organized around reading and writing those pages efficiently.

**B-trees** keep keys sorted in a shallow tree, so a lookup walks a few levels instead of scanning the table.[^2] PostgreSQL builds a B-tree by default; it serves equality and range operators, `BETWEEN`, `IN`, anchored `LIKE 'foo%'` and sorted output.[^3] Other index types fit other query shapes: hash (equality only), GIN (inverted index for multi-valued columns such as arrays), GiST and SP-GiST (geometric, tries, k-d trees), and BRIN (min/max summaries per block range for naturally ordered data).[^3]

**LSM trees** optimize for writes. In RocksDB, writes go to an in-memory **memtable** and, optionally, a write-ahead log; full memtables flush to sorted, immutable SST files, and background **compaction** merges them.[^4] The tuning space is a three-way trade between write, read and space amplification: leveled compaction keeps space amplification low, universal compaction lowers write amplification at the cost of more space and read amplification.[^4] Because a key may live in several files, LSM engines lean on Bloom filters: Cassandra keeps one per SSTable so reads skip files that cannot hold the key.[^5]

Indexes are not free. Every index must be kept in sync with its table, which adds overhead to each write, so unused indexes should be dropped.[^2]

### Write-ahead logging

The WAL rule: changes to data files may be written only after the log records describing them are flushed to permanent storage.[^6] That inverts the cost of a commit. Only the WAL, written sequentially, must be flushed at commit; data pages can be written lazily, and after a crash the engine redoes any change the pages missed (roll-forward recovery).[^6] One WAL flush can commit many concurrent transactions, and archived WAL enables point-in-time recovery onto an older base backup.[^6] Underneath, "flushed" means `fsync`, which pushes the file's modified pages, and any disk write cache, to the device.[^7]

### Transactions, MVCC and isolation

A transaction bundles steps into one all-or-nothing unit whose intermediate states are invisible to others; once acknowledged, it is permanently recorded.[^8]

PostgreSQL implements isolation with **MVCC**: each statement sees a snapshot of the data as of some moment, so "reading never blocks writing and writing never blocks reading".[^9] Two writers updating the same row still conflict.[^9] What a transaction may observe depends on its isolation level:[^10]

| Level | Dirty read | Nonrepeatable read | Phantom read | Serialization anomaly |
| --- | --- | --- | --- | --- |
| Read uncommitted | Allowed (not in PostgreSQL) | Possible | Possible | Possible |
| Read committed | Not possible | Possible | Possible | Possible |
| Repeatable read | Not possible | Not possible | Allowed (not in PostgreSQL) | Possible |
| Serializable | Not possible | Not possible | Not possible | Not possible |

Defaults differ. PostgreSQL defaults to Read Committed, where each statement gets a fresh snapshot.[^10] MySQL's InnoDB defaults to Repeatable Read, where all plain reads in a transaction use the snapshot taken by the first read.[^11] At Repeatable Read and Serializable, PostgreSQL may abort a transaction with SQLSTATE `40001`, and the application must retry the whole transaction:[^10]

```python
for attempt in range(5):
    try:
        with conn.transaction(isolation="serializable"):
            debit(conn, "alice", 100)
            credit(conn, "bob", 100)
        break
    except SerializationFailure:      # SQLSTATE 40001
        sleep(backoff(attempt))
```

### Data modeling from access patterns

A schema should follow the queries. Facebook's TAO stores a graph in MySQL: associations live in tables with an extra index on `(id1, atype, time)` so "newest edges of this type" is a range scan, and counts sit in a separate table to avoid `SELECT COUNT`.[^12] Notion chose **workspace ID** as its shard key because every block belongs to exactly one workspace and most queries stay inside one.[^13]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| B-tree storage | Predictable reads, efficient ranges | Random page writes; write amplification on updates |
| LSM storage | High write throughput; compact files | Reads may check several files; compaction work[^4] |
| Read Committed | Few aborts; simple | Nonrepeatable reads, phantoms, anomalies[^10] |
| Serializable | No anomalies | Must retry on `40001`[^10] |
| Many secondary indexes | Fast varied queries | Slower writes, more storage[^2] |
| Normalized schema | One copy of each fact; easy updates | Joins on read |
| Denormalized schema | Single-read access paths | Duplicated data to keep in sync |
| Application-level sharding | Full control of routing and migration | Cross-shard queries and transactions are on you[^13] |
| Packaged sharding (Citus, Vitess) | Less custom code | Another system to operate; Notion evaluated these before choosing app-level sharding[^13] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| PostgreSQL page size | 8 kB by default[^1] |
| PostgreSQL default isolation | Read Committed[^10] |
| InnoDB default isolation | Repeatable Read[^11] |
| Serialization failure code | SQLSTATE `40001`[^10] |
| PostgreSQL hash index entry | 32-bit hash code[^3] |
| Cassandra Bloom filter false-positive default | 0.01 (0.1 with leveled compaction)[^5] |
| Notion's shard layout (2021) | 480 logical shards on 32 physical databases, 15 each[^13] |
| Notion's single-Postgres era | About 5 years, four orders of magnitude of growth[^13] |
| Facebook TAO replica lag behind the master | < 1 s 85% of the time, < 3 s 99%, < 10 s 99.8%[^12] |

## Failure modes

- **Silent anomalies.** At Read Committed, two transactions can each read a balance, both pass a check, and both write. Nonrepeatable reads, phantoms and serialization anomalies are all allowed there.[^10] Use Serializable or explicit row locks for invariants that span reads.
- **Unhandled serialization failures.** Stronger isolation turns races into `40001` errors; without a retry loop they become user-facing failures.[^10]
- **Mixed snapshot semantics.** In InnoDB, locking statements read the latest committed data while plain `SELECT`s read the snapshot, so mixing them in one Repeatable Read transaction is discouraged.[^11]
- **Full scans.** A query with no usable index reads every row.[^2] Keep planner statistics fresh with `ANALYZE` and confirm hot queries use the indexes you built.[^2]
- **Maintenance falling behind.** Notion's Postgres saw recurring CPU spikes and `VACUUM` stalls, with transaction ID wraparound looming, long before the hardware limit.[^13]
- **Stale replica reads.** Asynchronous replicas lag; TAO measured lag up to 10 seconds in the tail.[^12] Read-your-writes needs routing to the primary or a version check.
- **Durability gaps.** A commit is durable only when its WAL record is on stable storage; disabling `fsync` or using a lying disk cache breaks that.[^6][^7]

## In the real world

- **Notion** sharded its PostgreSQL monolith in 2021 with application-level routing, double-writing to old and new databases, backfilling, verifying, then cutting over with about five minutes of planned downtime.[^13]
- **Facebook TAO** keeps MySQL as the persistent store for the social graph and puts a graph-aware cache in front of it.[^12]
- **RocksDB** began at Facebook as a storage engine for server workloads, forked from LevelDB 1.5 and extended with ideas from Apache HBase.[^4]
- **Apache Cassandra** uses Bloom filters per SSTable to keep LSM reads cheap.[^5]
- **PostgreSQL** pairs WAL with archived logs for point-in-time recovery.[^6]

## In a design interview

Start from the data and the queries, then justify the engine:

1. **Entities and access patterns.** "Orders by customer, newest first; order by ID; daily revenue report."
2. **Model and indexes.** "Relational, because orders, payments and inventory must change together in one transaction. Index `(customer_id, created_at DESC)`."
3. **Isolation for invariants.** "Inventory decrement under Serializable with retries, or `SELECT … FOR UPDATE` on the stock row."
4. **Scaling path.** "Indexes first, then a [[Caching|cache]] for hot reads, then read replicas, then shard by customer ID."

Expect probes on *why SQL over NoSQL here*, *what happens on a crash mid-commit* (WAL replay), *what isolation level and what anomaly it allows*, *how you'd shard and what breaks* (cross-shard joins and transactions), and *how stale a replica can be*.

## Check yourself

> [!question]- Why can a database acknowledge a commit before writing the changed table pages to disk?
> Because the WAL record describing the change is already on stable storage. After a crash, recovery replays the log and redoes any change the data pages are missing.

> [!question]- Two doctors must not both go off call, but under Read Committed both checks pass and both leave. What happened and what fixes it?
> A write-skew serialization anomaly: each transaction read the other's row before either wrote. Read Committed allows it; Serializable isolation, with retries on `40001`, or locking both rows prevents it.

> [!question]- Why do LSM-tree engines rely on Bloom filters more than B-tree engines?
> A key may sit in any of several SST files, so a read could probe many files. A Bloom filter per file rules most of them out without touching disk.

## Further reading

- 📄 [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — the clearest vendor explanation of anomalies and what each level prevents.
- 📄 [Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/current/wal-intro.html) — a one-page explanation of why logs make commits cheap and durable.
- 📝 [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion) — an honest account of when and how to shard.
- 📝 [RocksDB Overview](https://github.com/facebook/rocksdb/wiki/RocksDB-Overview) — LSM trees and compaction trade-offs from the people who run them at scale.
- 📄 [Concurrency Control: Introduction](https://www.postgresql.org/docs/current/mvcc-intro.html) — MVCC in two paragraphs.

## Related

- [[SQL Databases (Deep Dive)]] — relational engines, query planning and joins.
- [[NoSQL Databases (Deep Dive)]] — LSM-based and schemaless stores.
- [[Replication (Deep Dive)]] — replica lag and read-your-writes.
- [[Sharding (Deep Dive)]] — choosing shard keys and resharding.
- [[CAP Theorem (Deep Dive)]] — consistency choices once data spans nodes.
- [[Data Structures (Deep Dive)]] — B-trees, skip lists and Bloom filters up close.
- [[Embeddings & Vector Databases (Deep Dive)]] — databases built for similarity search instead of exact matches.

> [!nav] Keep going
> ← [[Networking (Deep Dive)|Networking]] · [[Core Concepts|🧠 Core Concepts]] · [[Requirements (Deep Dive)|Requirements]] →
> 🌱 Back to the basics: [[Databases]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^2]: 📄 [Indexes: Introduction](https://www.postgresql.org/docs/current/indexes-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^3]: 📄 [Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^4]: 📝 [RocksDB Overview](https://github.com/facebook/rocksdb/wiki/RocksDB-Overview) — RocksDB wiki, Meta. Article. Checked 2026-11.
[^5]: 📄 [Bloom Filters](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/bloom_filters.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
[^6]: 📄 [Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/current/wal-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^7]: 📄 [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) — Linux manual page. Official docs. Checked 2026-11.
[^8]: 📄 [Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Concurrency Control: Introduction](https://www.postgresql.org/docs/current/mvcc-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^10]: 📄 [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^11]: 📄 [Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html) — MySQL 8.4 Reference Manual. Official docs. Checked 2026-11.
[^12]: 🔬 [TAO: Facebook's Distributed Data Store for the Social Graph (full paper, PDF)](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf) — Bronson et al., USENIX ATC 2013. Paper. Checked 2026-11.
[^13]: 📝 [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion) — Garrett Fidalgo, Notion, 2021. Engineering blog. Checked 2026-11.
