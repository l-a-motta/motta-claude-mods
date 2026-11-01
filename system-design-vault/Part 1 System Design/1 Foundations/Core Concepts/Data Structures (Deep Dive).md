---
aliases: [Data Structures deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/core-concepts]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Core Concepts]]"
basics: "[[Data Structures]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Core Concepts]] › [[Data Structures]] › 🔬 Deep Dive

> [!tldr] For engineers
> A data structure is a **commitment about which operations are cheap**. Hash tables buy O(1) average point lookups and give up order; balanced trees and skip lists buy ordered and range access at O(log n); graphs make adjacency the primary query. In system design the same choices reappear one level up, as database indexes, cache layouts and storage engines, so reason from the dominant query and its worst case, not its average.

> [!basics]- New to this? Start with the basics
> [[Data Structures]] explains it with no jargon.

## How it really works

### Complexity, honestly stated

Big O classifies algorithms by how their run time or space grows with the input.[^1] Three qualifiers matter more in production than the headline letter:

- **Average vs. worst case.** Python's documentation lists dict and set operations as O(1), then warns these are average-case times that assume a hash function that makes collisions uncommon; if every key hashes to the same value, each O(1) operation becomes O(n).[^2]
- **Amortized.** `list.append` and dict insertion are O(1) *amortized*: an individual call may cost O(n) when the backing storage is resized, but that cost is spread over many operations.[^2]
- **Hidden constants.** Hashing and comparing a key are assumed to be O(1).[^2] For long string keys, they are not.

### Arrays and dynamic arrays

An array stores elements contiguously, so indexing is O(1).[^2] Inserting or popping at position *k* in a Python list is O(n − k), because every later element shifts; the end of the list is O(1) and the front is the worst case.[^2] Contiguity has a second payoff the complexity table hides: hardware caches and the TLB exploit **spatial locality**, so a dense array scan takes roughly one translation miss per 4 KB page.[^3]

### Hash tables

A hash table maps a key to a bucket with a hash function. Java's `HashMap` is a representative design: default capacity 16, default load factor 0.75, and when entries exceed capacity × load factor the table is rehashed into roughly twice the buckets.[^4] Its `get` and `put` are constant time only "assuming the hash function disperses the elements properly".[^4]

Two operational details bite at scale. Iteration costs time proportional to capacity plus size, not size alone.[^4] Python's tables also don't shrink on deletion: after removing most elements, scans still take time proportional to the former size until a later insertion triggers a resize.[^2]

### Ordered structures: trees and skip lists

When queries need order, ranges or "top N", you need a sorted structure. Balanced search trees and binary search give O(log n) lookups.[^1] Binary search over n sorted items takes at most ⌊log₂ n⌋ + 1 iterations, about 20 for a million items.[^5]

Databases use the disk-friendly variant, the **B-tree**. PostgreSQL's `CREATE INDEX` builds a B-tree by default; it serves equality and range operators (`<`, `<=`, `=`, `>=`, `>`, `BETWEEN`, `IN`), anchored prefix patterns such as `LIKE 'foo%'`, and can return rows already sorted.[^6] The same page shows the rest of the menu: hash indexes (a 32-bit hash code, equality only), GIN inverted indexes for multi-valued columns like arrays, SP-GiST for tries, quadtrees and k-d trees, and BRIN for block-range summaries on physically ordered data.[^6]

A **skip list** is the probabilistic alternative to a balanced tree. Redis sorted sets combine a skip list with a hash table: adding a member is O(log N), reading a member's score (`ZSCORE`) is O(1), and range reads need no sorting because the data is already ordered.[^7]

```text
ZADD board 4200 user:17       # O(log N)
ZREVRANK board user:17        # O(log N): rank from the top
ZRANGE board 0 9 REV          # O(log N + M): top 10
```

### Graphs

A graph is nodes plus edges, stored as adjacency lists so "neighbors of X" is one lookup. Facebook's TAO is the canonical production example: **objects** are typed nodes with a 64-bit id, **associations** are typed directed edges keyed by (id1, atype, id2), and each association carries a 32-bit time field.[^8] Queries run over an **association list**, all edges with a given id1 and type, kept in descending time order, because most reads want the newest items.[^8] Bidirectional relations such as FRIEND are stored as two edges kept in sync by configuring an inverse type.[^8]

### Probabilistic structures

A **Bloom filter** answers membership with "definitely not present" or "probably present". Cassandra keeps one per SSTable so a read can skip files that cannot contain the partition; typical false-positive rates are 1–10%, and a false positive costs a wasted disk read.[^9]

## Design choices and trade-offs

| Structure | Fast at | Slow at | Typical system use |
| --- | --- | --- | --- |
| Array / dynamic array | Index access, sequential scans | Insert or delete in the middle | Buffers, column storage, batch processing |
| Hash table | Exact-key lookup, insert, delete | Ordered or range queries; worst case on collisions | Caches, session stores, hash joins |
| B-tree | Point and range lookups, sorted output | Random writes cost page updates | Default database index |
| Skip list + hash table | Rank, range and score lookups in memory | Extra memory for two indexes | Redis sorted sets, leaderboards |
| Graph (adjacency lists) | Neighbor lookups, traversals | Global queries over the whole graph | Social graphs, recommendations |
| Bloom filter | Tiny, fast "definitely not" answers | False positives; no deletes in the basic form | Skipping files in LSM storage engines |
| Inverted index | "Which records contain term X?" | Updates touch many entries | Array and multi-value search |

The deciding question is always the dominant access pattern. Redis's leaderboard guide makes the point directly: computing one entity's rank in a relational table needs an `ORDER BY` over the full table, O(N) at best, while a sorted set keeps rank queries at O(log N).[^10]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Python dict/set lookup | O(1) average, O(n) worst case[^2] |
| Python `list.insert(0, x)` | O(n), the worst position[^2] |
| Java `HashMap` defaults | Capacity 16, load factor 0.75, ~2× on rehash[^4] |
| Binary search on 1 million sorted items | At most 20 iterations[^5] |
| Redis `ZADD`, `ZRANK` / `ZSCORE` | O(log N) / O(1)[^7] |
| Redis `ZRANGE` | O(log N + M), M = items returned[^7] |
| Redis leaderboard footprint | Millions of ranked members in roughly 500 MB[^10] |
| PostgreSQL hash index entry | 32-bit hash code of the column value[^6] |
| Cassandra Bloom filter default | `bloom_filter_fp_chance` 0.01 (0.1 with leveled compaction); 0.01 needs about 3× the memory of 0.1[^9] |
| Facebook TAO (2013) | A billion reads and millions of writes per second; 99.8% of requests are reads[^8] |

## Failure modes

- **Collision blow-up.** A poor or attacker-predictable hash collapses a table into a list and every O(1) becomes O(n).[^2] Defend with seeded hashes, bounded key sizes and limits on untrusted input.
- **Resize latency spikes.** Amortized O(1) still means an occasional O(n) rehash.[^2] For latency-sensitive paths, pre-size the table to the expected element count.
- **Unsynchronized sharing.** `HashMap` is not synchronized; if one thread modifies it structurally while others read, it must be synchronized externally.[^4] Use a concurrent map instead of hoping. See [[Concurrency (Deep Dive)]].
- **Memory that never comes back.** Tables that grew for a burst and don't shrink keep both the memory and the scan cost.[^2] Rebuild or recreate long-lived maps after bulk deletes.
- **Hidden linear scans.** A query with no matching index scans every row; so does a leading-wildcard `LIKE '%bar'`, which a B-tree cannot serve.[^6]
- **Hot and high-degree nodes.** In graphs, a celebrity node with thousands of comments makes naive traversals expensive; TAO leans on time-ordered association lists because only the newest edges are usually rendered.[^8]
- **Mis-tuned probabilistic filters.** Too high a false-positive rate sends reads to files that don't hold the data; too low wastes memory.[^9]

## In the real world

- **PostgreSQL** ships B-tree, hash, GiST, SP-GiST, GIN and BRIN index types, plus a bloom extension, each a different data structure for a different query shape.[^6]
- **Redis** exposes data structures as the API. Its documented leaderboard pattern is one sorted set per board plus a hash per entity for display metadata, with `ZINCRBY` for atomic score updates and `EXPIRE` to retire daily or weekly boards.[^10]
- **Facebook TAO** replaced memcache for many data types with a graph-aware cache over MySQL, serving the social graph at a billion reads per second.[^11][^8]
- **Apache Cassandra** uses Bloom filters to avoid touching SSTables that cannot contain a requested partition.[^9]
- **RocksDB** is an LSM-tree engine: writes land in an in-memory memtable, flush to sorted SST files, and are merged by background compaction, with Bloom filters to skip files.[^12]

## In a design interview

Interviewers rarely ask "what is a hash map". They ask you to design something whose hard part is a data structure: a leaderboard, autocomplete, a rate limiter, "people you may know". Lead with the query, then the structure:

1. **Name the dominant operations.** "Update a score on every game; read top 10 and my rank on every page view."
2. **Pick the structure and state its costs.** "A sorted set keyed by user: O(log N) update and rank, O(log N + 10) for the top 10."
3. **Say where it lives.** "In Redis, sharded by board, because no single app server holds every score."
4. **Cover the worst case.** "Ties broken by member id; very large boards split into score buckets."

Expect probes on average vs. worst case, memory per element at 100 million entries, and what happens when the structure no longer fits on one machine (see [[Sharding (Deep Dive)]]).

## Check yourself

> [!question]- A service's p99 latency spikes every few minutes while its average looks fine. It keeps a large in-memory hash map that grows steadily. What is a likely cause?
> Rehashing. Each resize rebuilds the table in O(n), which is cheap on average but shows up as periodic tail latency. Pre-sizing the map or using a structure that resizes incrementally removes the spikes.

> [!question]- Why can't a hash index serve `WHERE price BETWEEN 10 AND 20`?
> A hash scatters neighboring values across unrelated buckets, so it preserves equality only. Range queries need an ordered structure such as a B-tree, which keeps keys sorted.

> [!question]- Why does TAO keep each association list sorted by time instead of by destination id?
> The workload is dominated by "newest N" queries, such as recent comments on a check-in. Time order makes those a short prefix read, even when a node has thousands of edges.

## Further reading

- 📄 [Time complexity of operations on built-in types](https://docs.python.org/3/builtins/time-complexity.html) — compact table with honest notes on amortized and worst-case costs.
- 📄 [Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — a tour of six index data structures and which operators each supports.
- 📄 [Redis leaderboard](https://redis.io/docs/latest/develop/use-cases/leaderboard/) — a worked example of choosing a structure from the query pattern.
- 🔬 [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson) — how a graph data model shapes caching and consistency at scale.
- 📄 [Bloom Filters](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/bloom_filters.html) — a short, practical guide to tuning false-positive rates.

## Related

- [[Databases (Deep Dive)]] — B-trees, LSM trees and indexes in context.
- [[Caching (Deep Dive)]] — hash tables with eviction policies on top.
- [[NoSQL Databases (Deep Dive)]] — key-value, wide-column and graph stores.
- [[Sharding (Deep Dive)]] — what to do when the structure outgrows one machine.
- [[Embeddings & Vector Databases (Deep Dive)]] — approximate nearest-neighbor indexes for similarity search.
- [[Concurrency (Deep Dive)]] — making shared structures safe across threads.

> [!nav] Keep going
> ← [[Concurrency (Deep Dive)|Concurrency]] · [[Core Concepts|🧠 Core Concepts]] · [[Operating Systems (Deep Dive)|Operating Systems]] →
> 🌱 Back to the basics: [[Data Structures]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📖 [Big O notation](https://en.wikipedia.org/wiki/Big_O_notation) — Wikipedia. Encyclopedia. Checked 2026-11.
[^2]: 📄 [Time complexity of operations on built-in types](https://docs.python.org/3/builtins/time-complexity.html) — Python documentation. Official docs. Checked 2026-11.
[^3]: 📘 [Paging: Faster Translations (TLBs)](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-tlbs.pdf) — Arpaci-Dusseau, *Operating Systems: Three Easy Pieces*, ch. 19. Book. Checked 2026-11.
[^4]: 📄 [HashMap (Java SE 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html) — Oracle. Official docs. Checked 2026-11.
[^5]: 📖 [Binary search](https://en.wikipedia.org/wiki/Binary_search) — Wikipedia. Encyclopedia. Checked 2026-11.
[^6]: 📄 [Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — PostgreSQL documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) — Redis documentation. Official docs. Checked 2026-11.
[^8]: 🔬 [TAO: Facebook's Distributed Data Store for the Social Graph (full paper, PDF)](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf) — Bronson et al., USENIX ATC 2013. Paper. Checked 2026-11.
[^9]: 📄 [Bloom Filters](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/bloom_filters.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
[^10]: 📄 [Redis leaderboard](https://redis.io/docs/latest/develop/use-cases/leaderboard/) — Redis documentation. Official docs. Checked 2026-11.
[^11]: 🔬 [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson) — Bronson et al., USENIX ATC 2013. Paper. Checked 2026-11.
[^12]: 📝 [RocksDB Overview](https://github.com/facebook/rocksdb/wiki/RocksDB-Overview) — RocksDB wiki, Meta. Article. Checked 2026-11.
