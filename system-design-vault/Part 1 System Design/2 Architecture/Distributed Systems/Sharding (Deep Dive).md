---
aliases: [Sharding deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/distributed-systems]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Distributed Systems]]"
basics: "[[Sharding]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Distributed Systems]] › [[Sharding]] › 🔬 Deep Dive

> [!tldr] For engineers
> Sharding scales writes and storage past one machine by assigning each row to a shard via a **shard key** and a **placement function** (range, hash or directory). Almost every hard problem traces back to the key: hot partitions, scatter-gather queries, cross-shard transactions. Decouple **logical shards from physical hosts** so you can rebalance by moving whole shards instead of rehashing rows.

> [!basics]- New to this? Start with the basics
> [[Sharding]] explains it with no jargon.

## How it really works

A sharded system answers three questions: **which key** identifies a row's shard, **which function** maps keys to shards, and **who routes** each query. MongoDB shards per collection, partitions data into **chunks** with an inclusive lower and exclusive upper shard-key bound, and routes through `mongos` using metadata held on config servers.[^1] Each shard is itself a replica set, which is why sharding and [[Replication]] almost always appear together.[^1]

### Placement functions

- **Range.** Contiguous key ranges map to shards, so range scans are targeted to one or a few shards. A badly chosen key, especially one that grows monotonically, piles new writes onto the last range.[^1]
- **Hash.** The key is hashed first, spreading even monotonic keys evenly; the cost is that range queries become broadcasts.[^1]
- **Directory / lookup.** A function or table maps each row to an ID in a key space. Vitess computes a **keyspace ID** per row through a *Primary Vindex* and assigns shards contiguous ranges of that space, named by hex bounds such as `80-c0`; shards need not be equal in size.[^2]

### Why not `hash(key) % N`

```python
shard = hash(key) % N    # N: 4 -> 5 and nearly every key changes shard
```

With modulo placement, changing the slot count remaps nearly all keys.[^3] **Consistent hashing**, introduced by Karger et al. in 1997 for distributed web caching, hashes both keys and servers onto a ring; each key belongs to the next server clockwise, so adding the *n*th server moves only about 1/*n* of the keys.[^3] Dynamo notes the key benefit: a node joining or leaving affects only its immediate neighbors.[^4]

```python
ring = sorted((hash(f"{node}#{v}"), node) for node in nodes for v in range(vnodes))
def owner(key):
    i = bisect_left(ring, (hash(key),))     # first token clockwise of the key
    return ring[i % len(ring)][1]
```

Plain consistent hashing places nodes randomly, which yields uneven load and ignores differences in hardware.[^4] **Virtual nodes** fix both: each physical node owns many tokens, so a departing node's load spreads across all survivors, a new node takes a little from everyone, and bigger machines get more tokens.[^4] Cassandra 2.x defaulted to 256 tokens per node; later versions use a deterministic allocator that needs far fewer.[^5]

Dynamo's production experience pushed further. Random tokens forced a joining node to "steal" key ranges by scanning other nodes' stores, which is risky on a live system.[^4] Its final scheme, **Strategy 3**, splits the hash space into Q equal-sized partitions and gives each of S nodes Q/S of them, decoupling partitioning from placement; it had the best load-balancing efficiency of the three strategies tested.[^4]

**Jump consistent hash** (Lamping and Veach, 2014) needs no stored ring, fits in about five lines, and divides keys more evenly than Karger's scheme, but buckets must be numbered sequentially, so it suits data storage better than caches whose nodes come and go.[^6]

### Choosing the shard key

A good key spreads activity **evenly** across many values and matches the **dominant query**, so most requests hit one shard. DynamoDB's guidance is to design for uniform activity across all partition keys.[^7]

- **Notion** chose the workspace ID because every block belongs to exactly one workspace and users mostly query within one, so cross-shard joins are rare.[^8]
- **Discord** keys messages by `(channel_id, bucket)`, where a bucket is a static time window, so all of a channel's messages from one window are stored together.[^9]
- **DynamoDB** makes the stakes concrete: each partition tops out at 3,000 read units and 1,000 write units per second.[^7] For a naturally hot key such as today's date, **write sharding** appends a suffix from 1 to 200, spreading writes over 200 keys; reading a whole day then means 200 queries merged by the application.[^10] A *calculated* suffix, derived from an attribute such as order ID, keeps single-item lookups direct.[^10]

### Routing and cross-shard work

Queries that include the shard key (or its compound prefix) are **targeted**; queries without it are **broadcast** to every shard, and MongoDB warns these "can be long running operations."[^1] MongoDB supports distributed multi-document transactions on sharded clusters, but committed writes may become visible on different shards at different times.[^1]

### Rebalancing and resharding

MongoDB's **balancer** migrates ranges in the background, and since 5.0 a collection can be resharded onto a new key.[^1] Vitess splits and merges shards while the old ones keep serving traffic, copying and verifying data, with only a few seconds of read-only time at cutover.[^2] Notion avoided row-level rebalancing entirely: each of its 32 databases holds 15 logical shards as Postgres schemas, and 480 was chosen because it divides evenly as hosts grow from 32 to 40 to 48.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Range partitioning | Efficient range scans; human-readable placement | Hot tail with monotonic keys; needs splitting |
| Hash partitioning | Even spread, including monotonic keys | Range queries become scatter-gather |
| Directory / lookup | Arbitrary placement; easy moves of single tenants | Extra lookup; directory must be highly available |
| Consistent hashing with vnodes | Minimal movement when nodes change | Ring metadata; still needs many tokens for balance |
| Many logical shards per host | Rebalance by moving whole shards | More schemas, connections and metadata |
| Tenant ID as key | Single-shard queries per tenant | Large tenants become hot shards |
| Write sharding with suffixes | Removes a single hot key | Reads fan out and merge |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| DynamoDB per-partition maximum | 3,000 read units/s and 1,000 write units/s[^7] |
| Keys moved when adding the *n*th server (consistent hashing) | About 1/*n*[^3] |
| Notion layout | 480 logical shards on 32 databases, 15 per database[^8] |
| Notion backfill | About three days on a 96-CPU instance[^8] |
| Discord messages cluster | 177 Cassandra nodes → 72 ScyllaDB nodes[^9] |
| Discord p99 message reads | 40–125 ms → 15 ms after migration[^9] |
| Vitess resharding cutover | A few seconds of read-only time[^2] |
| Cassandra 2.x default tokens per node | 256[^5] |

## Failure modes

- **Hot partitions.** At Discord, heavy concurrent reads on one channel-and-bucket overloaded its partition; because quorum reads and writes involve every affected replica, latency rose across the cluster.[^9] Discord added Rust data services that **coalesce** identical concurrent requests into one database query and route by channel ID with consistent hashing, so the same channel always reaches the same instance.[^9]
- **Monotonic keys.** Timestamps or auto-increment IDs under range partitioning send all inserts to one shard. Hash the key or add a suffix.[^1][^10]
- **Scatter-gather tail latency.** A broadcast query waits for every shard, so it is as slow as the slowest one, and MongoDB warns such queries can run long.[^1] Denormalize or add a secondary index keyed for that access path.
- **Painful rebalancing.** Moving data competes with live traffic; Dynamo's random-token scheme required scanning production stores to hand off ranges.[^4] Pre-split into fixed logical shards.
- **Cross-shard anomalies.** Distributed transactions can expose partially visible commits across shards.[^1] Keep invariants within one shard where possible.
- **Big-bang migrations.** Notion double-wrote via an audit log, backfilled, then verified with sampled comparisons and dark reads before cutover.[^8]

## In the real world

- **Notion** sharded its Postgres monolith by workspace ID after `VACUUM` stalls and fears of transaction ID wraparound.[^8]
- **Discord** moved trillions of messages, partitioned by channel and time bucket, from Cassandra to ScyllaDB in 2022.[^9]
- **Amazon DynamoDB** partitions tables by partition key behind the scenes and documents write sharding as the cure for hot keys.[^7][^10]
- **Vitess** shards MySQL behind a routing layer and reshards online.[^2]
- **MongoDB** offers ranged, hashed and zone-based sharding through `mongos`.[^1]
- **Cassandra** places partitions on a token ring with vnodes and per-datacenter replication.[^5]

## In a design interview

1. **Justify it:** "Writes are ~50k/s and data is ~20 TB, past one primary, so shard."
2. **Pick the key from the access pattern:** "Every request is scoped to a tenant, so `tenant_id`."
3. **Pick the function:** "Hash for even spread, with 1,024 logical shards mapped to 16 hosts."
4. **Handle hot tenants:** "Move big tenants to dedicated shards via a directory override."
5. **Cross-shard queries:** "Analytics runs off a replicated warehouse, not the shards."

Interviewers probe: *What happens when you add a node?* (Logical shards move; consistent hashing bounds the movement.) *What if one key gets 100x traffic?* (Suffix it, cache it, coalesce it.) *How do you query across shards?* *How do you reshard without downtime?*

## Check yourself

> [!question]- Why do virtual nodes improve balance compared with one token per node?
> With one random token each, nodes own arcs of very different sizes, and a failed node dumps its whole arc on one neighbor. Many tokens per node average out arc sizes and spread a departing node's load across all survivors.

> [!question]- When would range partitioning beat hash partitioning?
> When the dominant query is a range scan on the key, such as time-ordered events per device with a compound key. Range keeps those rows together so the scan hits one shard; hashing would scatter them.

> [!question]- Why did Notion choose 480 logical shards rather than 512?
> 480 has many divisors, so the fleet can grow in small steps (32, 40, 48 hosts) while staying evenly loaded. 512 would force doubling from 32 to 64 hosts.

## Further reading

- 📄 [Sharding](https://www.mongodb.com/docs/manual/sharding/) — concise reference on shard keys, chunks, balancing and targeted vs broadcast queries.
- 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — compares three partitioning strategies with real production data.
- 📝 [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion) — a full, honest migration playbook.
- 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — hot partitions and request coalescing in practice.
- 🔬 [A Fast, Minimal Memory, Consistent Hash Algorithm](https://arxiv.org/abs/1406.2294) — jump consistent hash in about five lines.

## Related

- [[Replication (Deep Dive)]] — every shard needs its own replicas and failover.
- [[CAP Theorem (Deep Dive)]] — consistency across shards and partitions.
- [[Caching (Deep Dive)]] — consistent hashing spreads cache keys too.
- [[NoSQL Databases (Deep Dive)]] — systems that shard by default.
- [[Load Balancing (Deep Dive)]] — consistent hashing for request routing.
- [[Embeddings & Vector Databases (Deep Dive)]] — sharding large vector indexes.

> [!nav] Keep going
> ← [[Replication (Deep Dive)|Replication]] · [[Distributed Systems|🕸️ Distributed Systems]] · [[API Design (Deep Dive)|API Design]] →
> 🌱 Back to the basics: [[Sharding]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Sharding](https://www.mongodb.com/docs/manual/sharding/) — MongoDB Manual. Official docs. Checked 2026-11.
[^2]: 📄 [Sharding](https://vitess.io/docs/reference/features/sharding/) — Vitess documentation. Official docs. Checked 2026-11.
[^3]: 📖 [Consistent hashing](https://en.wikipedia.org/wiki/Consistent_hashing) — Wikipedia. Encyclopedia. Checked 2026-11.
[^4]: 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — DeCandia et al., SOSP 2007. Paper. Checked 2026-11.
[^5]: 📄 [Dynamo (Cassandra architecture)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html) — Apache Cassandra documentation. Official docs. Checked 2026-11.
[^6]: 🔬 [A Fast, Minimal Memory, Consistent Hash Algorithm](https://arxiv.org/abs/1406.2294) — John Lamping and Eric Veach, arXiv, 2014. Paper. Checked 2026-11.
[^7]: 📄 [Best practices for designing and using partition keys effectively in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
[^8]: 📝 [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion) — Garrett Fidalgo, Notion Blog, 2021. Engineering blog. Checked 2026-11.
[^9]: 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — Bo Ingram, Discord Blog, 2023. Engineering blog. Checked 2026-11.
[^10]: 📄 [Using write sharding to distribute workloads evenly in your DynamoDB table](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html) — Amazon DynamoDB Developer Guide. Official docs. Checked 2026-11.
