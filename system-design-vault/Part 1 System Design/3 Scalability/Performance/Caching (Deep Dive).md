---
aliases: [Caching deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/performance]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Performance]]"
basics: "[[Caching]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Performance]] › [[Caching]] › 🔬 Deep Dive

> [!tldr] For engineers
> A cache trades **freshness and memory for latency and offloaded reads**. Most designs combine cache-aside reads, a TTL as a safety net, and explicit invalidation on writes. The hard problems are consistency between cache and source, eviction under memory pressure, and stampedes when a hot key expires.

> [!basics]- New to this? Start with the basics
> [[Caching]] explains it with no jargon.

## How it really works

A cache is a key-value store sitting in front of a slower **system of record**. Every design answers three questions: **who fills the cache**, **what happens on a write**, and **what leaves when memory runs out**.

### Read strategies

**Cache-aside (lazy loading).** The application owns the logic. It reads the cache; on a miss it queries the database and writes the result back.[^1] Only data that is actually requested gets cached, and a cache node failure is survivable: a fresh empty node just causes misses until it warms up.[^1] The cost is a **miss penalty of three round trips** (cache, database, cache write) and the risk of stale data, because nothing updates the cache when the database changes.[^1]

```python
def get_customer(customer_id):
    record = cache.get(customer_id)
    if record is None:                      # miss
        record = db.query("SELECT * FROM customers WHERE id = %s", customer_id)
        cache.set(customer_id, record, ttl=300)
    return record
```

**Read-through.** Same flow, but the cache library or proxy loads from the database itself, so the application only ever talks to the cache.

### Write strategies

**Write-through.** Every database write also updates the cache, so cached data is never stale.[^1] The trade is a write penalty (two writes per update) plus **cache churn**: most of what is written is never read.[^1] A new or replaced node starts empty, so write-through is usually combined with lazy loading.[^1]

**Write-behind (write-back).** Writes land in the cache and are flushed to the database asynchronously. Write latency is minimal, but a cache crash before the flush loses data, so it needs a durable buffer.

**Invalidate on write (delete, don't update).** Many systems delete the key on write and let the next read repopulate it. Deleting is idempotent and avoids racing two writers' `set` calls; Facebook's memcache layer uses this approach with leases to arbitrate concurrent fills.[^2]

### Expiry and eviction

A **TTL** bounds staleness: an expired key is treated as a miss.[^1] It does not guarantee freshness; it only limits how stale a value can get.[^1]

**Eviction** decides what to drop when memory is full. Redis exposes it as `maxmemory-policy`:[^3]

| Policy | Evicts | Use when |
| --- | --- | --- |
| `allkeys-lru` | Least recently used key | Default choice: a hot subset gets most reads (Pareto) |
| `allkeys-lfu` | Least frequently used key | Popularity is stable over time |
| `allkeys-random` | Random key | Access is roughly uniform, e.g. cyclic scans |
| `volatile-ttl` | Key with the shortest remaining TTL | Code can mark good eviction candidates via short TTLs |
| `volatile-lru` | LRU among keys with a TTL | One instance mixes cache keys and persistent keys |
| `noeviction` | Nothing; writes error out | The instance is a store, not a cache |

Redis's LRU is **approximated**: it samples a few keys (`maxmemory-samples`, default 5) and evicts the oldest, because exact LRU costs more memory.[^3] LFU uses a probabilistic Morris counter with decay, so formerly hot keys can age out.[^3]

### Layers of caching

Caches stack: browser → [[CDN]] → reverse proxy → application cache (Redis, Memcached) → database buffer pool.[^4] HTTP caching is governed by headers: `Cache-Control: max-age=…` sets freshness, and stale entries are **revalidated** with `ETag`/`If-None-Match`, which returns a bodyless `304 Not Modified` when nothing changed.[^5]

```http
Cache-Control: public, max-age=31536000, immutable   # versioned static assets
Cache-Control: no-cache, private                     # HTML and personalized pages
```

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Cache-aside | Simple; caches only what is read; survives node loss | Miss penalty; stale until TTL or invalidation |
| Write-through | Reads always fresh | Slower writes; caches unread data |
| Write-behind | Fastest writes; absorbs write bursts | Data loss on crash; complex ordering |
| Long TTL | High hit ratio, low DB load | More staleness |
| Short TTL | Fresher data | More misses, more DB load |
| Local in-process cache | No network hop (nanoseconds) | Each instance has its own copy; hard to invalidate |
| Shared distributed cache | One copy for all app servers | Network hop; another system to run |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| In-memory cache read latency | Sub-millisecond[^4] |
| Throughput of one in-memory cache node | Hundreds of thousands of ops/s[^4] |
| Facebook memcache scale (2013) | Billions of requests/s, trillions of items[^2] |
| Items fetched from cache to render one popular Facebook page | 521 on average, 1,740 at p95[^6] |
| Peak DB query rate for stampede-prone keys, without → with leases | 17K/s → 1.3K/s[^6] |
| Redis LRU sample size | 5 keys by default; 10 approximates true LRU closely[^3] |

A quick health check: hit ratio = `keyspace_hits / (keyspace_hits + keyspace_misses)`.[^3] If it sits well below the share of traffic you believe is "hot", look at `evicted_keys` (wrong policy or too little memory) and `expired_keys` (TTLs too short).[^3]

## Failure modes

- **Stale data.** A write updates the database but the delete or update of the cache fails or arrives late. Defend with TTLs as a backstop and with ordered invalidation (delete after commit).
- **Stale sets.** Two clients miss, read different versions, and the older one writes last. Facebook's **leases** fix this: on a miss memcached hands out a 64-bit token, and a later `set` is rejected if the key was invalidated in between.[^6]
- **Thundering herd / cache stampede.** A hot key expires and thousands of requests miss at once and pile onto the database. Defenses: leases or a lock so one client refills while others wait (Facebook issues one token per key every 10 seconds),[^6] serving stale while revalidating, and **TTL jitter** so keys don't expire together.
- **Cold start.** A new or flushed cache sends every request to the database. Warm caches before shifting traffic.
- **Hot keys.** One key gets so much traffic that its shard melts. Replicate hot keys or add a small local cache in front.
- **Memory pressure.** With `noeviction`, writes start failing once `maxmemory` is reached.[^3] With replication or persistence, leave headroom for output buffers, which don't count toward `maxmemory`.[^3]

## In the real world

- **Facebook** built a regional memcache tier, a `mcrouter` proxy, and leases on top of memcached; the paper is the canonical case study of caching at scale.[^2][^6]
- **Redis and Valkey** are the default shared caches today; Memcached remains popular for pure, simple caching.[^3]
- **Amazon ElastiCache** documents lazy loading, write-through and TTL as its recommended combination.[^1]
- **CDNs** such as CloudFront or Cloudflare cache HTTP responses at the edge, following `Cache-Control` headers.[^5]

## In a design interview

Say where the cache sits and why, then cover the three questions:

1. **Fill:** "Cache-aside in front of the user-profile DB; reads dominate 100:1."
2. **Writes:** "Delete the key after the DB commit; TTL of 10 minutes as a backstop."
3. **Eviction and sizing:** "LRU; the hot 20% of profiles is about N GB, so three nodes with replicas."

Interviewers then probe: *What if the cache goes down?* (DB must survive the miss storm: rate limit, warm-up.) *How stale can data be?* (Tie TTL to the requirement.) *Hot keys?* (Replicate or local cache.) *Stampede?* (Leases, locks, jitter.)

## Check yourself

> [!question]- Why do many systems delete a cache key on write instead of updating it?
> Deletes are idempotent and avoid a race where two concurrent writers set the cache in the wrong order. The next read repopulates from the source of truth.

> [!question]- Your hit ratio is 40% but you expected 80%. What do you check first?
> `evicted_keys` (too little memory or the wrong eviction policy, e.g. random instead of LRU on skewed traffic) and `expired_keys` (TTLs shorter than the reuse interval).

> [!question]- How do leases mitigate a thundering herd?
> Only the client holding the lease refills the key. Others get told to wait briefly and retry, by which time the value is cached, so the database sees one query instead of thousands.

## Further reading

- 🔬 [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) — the classic real-world paper on consistency, leases and regional caches.
- 📄 [Caching strategies for Memcached](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html) — short, clear comparison of lazy loading, write-through and TTL with pseudocode.
- 📄 [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/) — every Redis eviction policy, with tuning advice from the INFO stats.
- 📄 [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — the definitive guide to browser and CDN caching headers.

## Related

- [[CDN (Deep Dive)]] — edge caching and cache keys.
- [[Replication (Deep Dive)]] — replicas are another way to scale reads.
- [[Sharding (Deep Dive)]] — consistent hashing spreads cache keys across nodes.
- [[Load Balancing (Deep Dive)]] — the other half of read scaling.
- [[LLM Inference & Optimization (Deep Dive)]] — KV caches and prompt caching in LLM serving.

> [!nav] Keep going
> ← [[WebSockets (Deep Dive)|WebSockets]] · [[Performance|⚡ Performance]] · [[CDN (Deep Dive)|CDN]] →
> 🌱 Back to the basics: [[Caching]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Caching strategies for Memcached](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html) — Amazon ElastiCache User Guide. Official docs. Checked 2026-11.
[^2]: 🔬 [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) — Nishtala et al., USENIX NSDI 2013. Paper. Checked 2026-11.
[^3]: 📄 [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/) — Redis documentation. Official docs. Checked 2026-11.
[^4]: 📄 [Caching Overview](https://aws.amazon.com/caching/) — Amazon Web Services. Official docs. Checked 2026-11.
[^5]: 📄 [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — MDN Web Docs. Official docs. Checked 2026-11.
[^6]: 🔬 [Scaling Memcache at Facebook (full paper, PDF)](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) — Nishtala et al., USENIX NSDI 2013, sections 3.1–3.2. Paper. Checked 2026-11.
