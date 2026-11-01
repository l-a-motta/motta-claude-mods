---
aliases: [SQL Databases deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/data-and-storage]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Data & Storage]]"
basics: "[[SQL Databases]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Data & Storage]] › [[SQL Databases]] › 🔬 Deep Dive

> [!tldr] For engineers
> A relational database stores **normalized tables** guarded by constraints and changes them through **ACID transactions**. Under the hood, a write-ahead log makes commits durable, MVCC lets readers and writers proceed without blocking each other, B-tree indexes and a cost-based planner make queries fast. The price is a **single-primary write path** that you eventually scale with replicas and sharding.

> [!basics]- New to this? Start with the basics
> [[SQL Databases]] explains it with no jargon.

## How it really works

### The relational model

E. F. Codd at IBM proposed the relational model in 1970: data as relations (tables) of tuples (rows), so information could be retrieved without specialized computer knowledge.[^1][^2] SQL, the language nearly every relational system speaks, came from IBM researchers Don Chamberlin and Ray Boyce.[^2] IBM's System R prototype began in 1974 and Oracle shipped in 1979.[^1]

**Normalization** is the discipline of splitting data so each fact lives in one place. Codd defined first normal form in 1970 and second and third normal forms in 1971; the goal is to remove **insertion, update and deletion anomalies**, and a schema in 3NF is informally called "normalized".[^3] Constraints then enforce the shape: `NOT NULL`, `UNIQUE`, `CHECK`, `PRIMARY KEY` (unique and not null) and `FOREIGN KEY`, which maintains **referential integrity** between tables.[^4]

```sql
CREATE TABLE orders (
  order_id    bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers ON DELETE RESTRICT,
  total       numeric CHECK (total >= 0)
);
```

`ON DELETE RESTRICT` refuses to delete a customer who still has orders; `CASCADE` would delete the orders too.[^4]

### Transactions and ACID

A transaction is atomic (all or nothing), consistent (leaves every constraint satisfied), isolated (concurrent transactions don't overwrite each other) and durable (committed changes persist).[^5]

**Durability comes from the write-ahead log (WAL).** PostgreSQL writes a log record describing each change and flushes it to permanent storage before the changed data pages are written.[^6] After a crash, the database replays the log to redo anything that never reached the data files.[^6] This is also why commits are cheap: only the sequential WAL must be flushed at commit, and one `fsync` can commit many small concurrent transactions at once.[^6]

**Isolation comes from MVCC.** PostgreSQL keeps multiple versions of rows, so each statement sees a snapshot of the database. Read locks don't conflict with write locks: "reading never blocks writing and writing never blocks reading."[^7] The isolation level decides how that snapshot is taken:[^8]

| Level (PostgreSQL) | Snapshot taken at | Prevents | Still allows |
| --- | --- | --- | --- |
| Read Committed (default) | Start of each statement | Dirty reads | Nonrepeatable reads, phantoms, serialization anomalies |
| Repeatable Read | First statement of the transaction | Above, plus nonrepeatable reads and phantoms | Serialization anomalies |
| Serializable (SSI) | First statement, plus dependency tracking | All four phenomena | Nothing; conflicts abort instead |

PostgreSQL accepts `READ UNCOMMITTED` but treats it as Read Committed, because that is the only sensible mapping onto MVCC.[^8] At Repeatable Read and Serializable, conflicts surface as errors with SQLSTATE `40001`, and the application must **retry the whole transaction**.[^8]

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;  -- on SQLSTATE 40001: roll back and rerun from BEGIN
```

### Storage and indexes

`CREATE INDEX` builds a **B-tree** by default. B-trees answer equality and range predicates (`<`, `=`, `BETWEEN`, `IN`, `IS NULL`) and prefix matches like `LIKE 'foo%'`, but not `LIKE '%bar'`; they can also return rows already sorted.[^9] Other PostgreSQL index types cover narrower jobs: hash for equality only, GIN as an inverted index for multi-valued data such as arrays, GiST for geometry and nearest-neighbor, BRIN for huge tables whose values follow physical order.[^9]

MySQL's InnoDB engine stores each table **inside its primary-key B-tree** (the clustered index). Every secondary index entry carries the row's primary key, and a lookup through it does a second search in the clustered index. A long primary key therefore makes every secondary index bigger, so InnoDB recommends a short key such as an auto-increment column.[^10]

### Query planning

The planner always has a sequential scan available and adds index scans when an index matches a filter or sort order.[^11] It then costs three join algorithms: **nested loop** (great when the inner side has an index), **merge join** (both sides sorted, each scanned once) and **hash join** (build a hash table on one side, probe with the other), and keeps the cheapest estimated plan.[^11] With many tables, exhaustive search becomes impractical and PostgreSQL switches to a genetic optimizer that finds a reasonable, not necessarily optimal, join order.[^11]

`EXPLAIN` prints the chosen plan tree with estimated costs and row counts. `EXPLAIN ANALYZE` actually runs the query and adds real row counts and timings, so wrap writes in `BEGIN … ROLLBACK`.[^12]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Normalize to 3NF | No update anomalies; one place to change a fact | More joins at read time |
| Denormalize hot paths | Fewer joins, faster reads | Duplicate data to keep in sync |
| Read Committed | Fast, no serialization retries | Anomalies across statements |
| Serializable | True serial-equivalent correctness | Retry logic for `40001` failures |
| Foreign keys in the database | Integrity enforced for every client | Extra checks on writes; harder to split across shards |
| Short surrogate primary key | Small secondary indexes in InnoDB | Natural key needs its own `UNIQUE` index |
| Scale up one primary | Simple; keeps all ACID guarantees | Hardware ceiling for writes |
| [[Replication (Deep Dive)\|Read replicas]] | Cheap read scaling | Replicas lag the primary |
| [[Sharding (Deep Dive)\|Shard]] (for example with Vitess) | Write scaling | Cross-shard joins and transactions get hard |

Relational systems traditionally scale vertically, with read-only replicas as the first add-on; NoSQL stores were built to partition from the start.[^13]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Default PostgreSQL `max_connections` | Typically 100; memory is sized from it[^14] |
| PostgreSQL default isolation level | Read Committed[^8] |
| SQLSTATE for serialization failure | `40001`[^8] |
| GitHub MySQL fleet (2023) | 1,200+ hosts, 300+ TB, 5.5M queries/s, 50+ clusters[^15] |
| SQLite databases in active use | Estimated over one trillion[^16] |
| Relational model and first normal form | 1970; 2NF and 3NF in 1971[^3] |

## Failure modes

- **Connection exhaustion.** Each PostgreSQL connection reserves server resources, and the default ceiling is about 100.[^14] Thousands of app instances opening their own connections hit it fast. Defend with a connection pooler and per-service limits.
- **Serialization failures under load.** Stricter isolation turns races into `40001` errors.[^8] Code that doesn't retry surfaces them to users. Wrap transactions in a generic retry loop and keep them short.
- **Anomalies at Read Committed.** Each statement gets a fresh snapshot, so a multi-step read-modify-write can see inconsistent data; the docs say this mode "is not sufficient for all cases".[^8] Use Repeatable Read, Serializable or explicit row locks for invariants that span statements.
- **The accidental full scan.** A missing or unusable index (say, `LIKE '%term'`) forces a sequential scan.[^9][^11] Find it with `EXPLAIN ANALYZE` on production-shaped data.[^12]
- **Index bloat from wide keys.** In InnoDB, a long primary key is copied into every secondary index.[^10]
- **Surprise cascades.** `ON DELETE CASCADE` deletes child rows silently.[^4] Reserve it for rows that can't exist without the parent.
- **The write ceiling.** One primary takes every write. GitHub moved large domains that outgrew a single-primary cluster onto horizontally sharded Vitess clusters.[^15]

## In the real world

- **GitHub** began as a Rails app on one MySQL database. It now runs 50+ clusters, each a primary plus replicas, partitioned by product domain, with Vitess for the biggest domains.[^15]
- **SQLite** ships in every Android and iOS device, every Mac, Windows 10/11 and every major browser, which is why it is likely the most deployed database engine.[^16]
- **PostgreSQL** implements Serializable as Serializable Snapshot Isolation, keeping the readers-never-block-writers property even at the strictest level.[^7]

## In a design interview

Default to a relational database when the data is **related, needs integrity, and must change transactionally**: users, orders, payments, inventory. Then show you know where it hurts.

1. **Schema:** "Normalized `users`, `orders`, `order_items`; foreign keys; `orders(customer_id, created_at)` index for the order-history page."
2. **Consistency:** "Read Committed by default; the checkout runs Serializable with retries, or uses `SELECT … FOR UPDATE` on inventory."
3. **Scale:** "One primary, read replicas for browsing traffic, a [[Caching (Deep Dive)|cache]] in front of product pages; shard by `customer_id` only if writes outgrow the primary."

Interviewers probe: *How do you avoid double-spending?* (Transactions plus the right isolation level.) *What breaks first at 10x?* (Connections, then write throughput.) *Why not NoSQL?* (Joins, constraints and ad-hoc queries; switch when access patterns are simple and scale is extreme.)

## Check yourself

> [!question]- Why does PostgreSQL's Read Uncommitted behave exactly like Read Committed?
> Under MVCC every statement reads from a snapshot of committed row versions, so there is no path to see another transaction's uncommitted data. Mapping Read Uncommitted onto Read Committed is the only sensible fit.

> [!question]- A transfer at Serializable fails with SQLSTATE 40001. What should the application do?
> Roll back and rerun the whole transaction from the start, ideally through a generic retry wrapper. The error means another concurrent transaction would have made the result non-serializable.

> [!question]- Why is a 36-character string primary key costly in InnoDB?
> InnoDB copies the primary key into every secondary index entry, so a long key inflates every index and the memory needed to cache them. A short surrogate key keeps them small.

## Further reading

- 📄 [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — the clearest official explanation of isolation levels and serialization failures.
- 📄 [Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html) — one page on why logging first makes commits both safe and fast.
- 📄 [Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html) — how InnoDB lays rows out, and why primary key choice matters.
- 📄 [Planner/Optimizer](https://www.postgresql.org/docs/current/planner-optimizer.html) — how join strategies and join order are chosen.
- 📝 [Upgrading GitHub.com to MySQL 8.0](https://github.blog/engineering/infrastructure/upgrading-github-com-to-mysql-8-0/) — what operating 1,200 MySQL hosts actually looks like.

## Related

- [[NoSQL Databases (Deep Dive)]] — the partition-first alternative and its trade-offs.
- [[Replication (Deep Dive)]] — WAL shipping, replica lag and failover.
- [[Sharding (Deep Dive)]] — splitting a relational schema across nodes.
- [[CAP Theorem (Deep Dive)]] — why a single primary chooses consistency.
- [[Caching (Deep Dive)]] — offloading reads from the primary.
- [[Data Engineering & Pipelines (Deep Dive)]] — moving relational data into analytics and ML.

> [!nav] Keep going
> ← [[Serverless (Deep Dive)|Serverless]] · [[Data & Storage|🗄️ Data & Storage]] · [[NoSQL Databases (Deep Dive)|NoSQL Databases]] →
> 🌱 Back to the basics: [[SQL Databases]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📖 [Relational database](https://en.wikipedia.org/wiki/Relational_database) — Wikipedia. Encyclopedia. Checked 2026-11.
[^2]: 📝 [What is a relational database?](https://www.ibm.com/think/topics/relational-databases) — IBM Think. Article. Checked 2026-11.
[^3]: 📖 [Database normalization](https://en.wikipedia.org/wiki/Database_normalization) — Wikipedia. Encyclopedia. Checked 2026-11.
[^4]: 📄 [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^5]: 📄 [What is a Relational Database?](https://aws.amazon.com/relational-database/) — Amazon Web Services. Official docs. Checked 2026-11.
[^6]: 📄 [Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/current/wal-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Concurrency Control: Introduction](https://www.postgresql.org/docs/current/mvcc-intro.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^8]: 📄 [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^10]: 📄 [Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html) — MySQL 8.4 Reference Manual. Official docs. Checked 2026-11.
[^11]: 📄 [Planner/Optimizer](https://www.postgresql.org/docs/current/planner-optimizer.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^12]: 📄 [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^13]: 📄 [What is NoSQL?](https://aws.amazon.com/nosql/) — Amazon Web Services. Official docs. Checked 2026-11.
[^14]: 📄 [Connections and Authentication](https://www.postgresql.org/docs/current/runtime-config-connection.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^15]: 📝 [Upgrading GitHub.com to MySQL 8.0](https://github.blog/engineering/infrastructure/upgrading-github-com-to-mysql-8-0/) — GitHub Engineering blog, 2023. Engineering blog. Checked 2026-11.
[^16]: 📄 [Most Widely Deployed SQL Database Engine](https://www.sqlite.org/mostdeployed.html) — SQLite. Official docs. Checked 2026-11.
