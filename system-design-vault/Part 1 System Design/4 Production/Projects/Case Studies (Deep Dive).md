---
aliases: [Case Studies deep dive]
tags: [level/deep-dive, part/1, section/production, branch/projects]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Projects]]"
basics: "[[Case Studies]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Projects]] › [[Case Studies]] › 🔬 Deep Dive

> [!tldr] For engineers
> The three canonical case studies each stress one axis. A **URL shortener** is a read-heavy key-value lookup whose real problem is unique short-key generation. A **news feed** is a fan-out problem: precompute on write, merge on read, and special-case high-follower accounts. A **chat system** is an ordered, append-heavy store partitioned by conversation, where time-sortable IDs and bounded partitions matter more than raw throughput. Learn the reasoning, not the diagrams: change the numbers and the answer changes.

> [!basics]- New to this? Start with the basics
> [[Case Studies]] explains it with no jargon.

## How it really works

Every case study runs the same loop: use cases and constraints, back-of-the-envelope numbers, a [[High-Level Design (Deep Dive)|high-level design]], core components, then scaling by finding bottlenecks, which is iterative because "everything is a trade-off".[^1] The estimates below come from the System Design Primer's worked solutions. They are **exercise assumptions**, not company figures; the Discord and Snowflake numbers are real production data.

### URL shortener (Pastebin / Bit.ly)

**Assumptions:** 10M users, 10M writes and 100M reads per month (10:1 read/write); reads must be fast.[^2]

**Estimates:** ~1.27 KB per entry → 12.7 GB of new content a month, ~450 GB and ~360M short links over three years; ~4 writes/s and ~40 reads/s on average, using 2.5M seconds per month.[^2]

**Design:** a reverse proxy in front of separate **Write API** and **Read API** servers, a SQL table for metadata, an object store for paste bodies, a memory cache for hot links and SQL read replicas behind it.[^2]

**Key generation:** MD5 of IP plus timestamp, Base62-encoded (`[a-zA-Z0-9]`, no URL escaping), truncated to 7 characters. That yields 62^7 ≈ 3.5 trillion keys, ample for 360M; on a duplicate, regenerate.[^2]

```sql
CREATE TABLE pastes (
  shortlink                    CHAR(7)      NOT NULL PRIMARY KEY,
  expiration_length_in_minutes INT          NOT NULL,
  created_at                   DATETIME     NOT NULL,
  paste_path                   VARCHAR(255) NOT NULL  -- object-store key
);
CREATE INDEX idx_created_at ON pastes (created_at);
```

A collision-free alternative is to encode a unique numeric ID in Base62. A Snowflake-style generator produces such IDs without coordination between machines.[^3]

### News feed (Twitter timeline)

**Assumptions:** 100M active users, 500M posts a day, an average fan-out of 10 deliveries per post, 250B timeline reads a month; heavily read-skewed.[^4]

**Estimates:** ~6,000 posts/s, ~60,000 fan-out deliveries/s, ~100,000 reads/s, ~150 TB of new content a month.[^4]

**Fan-out on write:** the Write API stores the post, then a **Fan Out Service** asks the User Graph Service for followers and appends the post ID to each follower's home timeline, a Redis list in memory.[^4] The cost is O(followers) per post; a timeline read becomes an O(1) list fetch plus a multiget for post and user details.[^4]

**The celebrity problem:** fanning out to millions of followers can take minutes and races with replies. The fix is hybrid: skip fan-out for high-follower accounts and merge their recent posts into the timeline at read time.[^4] Memory is bounded by keeping only several hundred entries per timeline and only users active in the last 30 days; inactive timelines are rebuilt from the database.[^4]

### Chat system (Discord)

Discord's 2017 requirements read like an interview prompt: linear scalability without manual re-sharding, automatic failover, low maintenance, proven technology and predictable performance (a p95 alert at 80 ms).[^5] Its reads were "extremely random" and its read/write ratio about 50/50.[^5]

The data model partitions by conversation and orders by a time-sortable ID, with a time bucket to cap partition size.[^5] A schema in that shape:

```sql
-- illustrative; only the primary key is Discord's
CREATE TABLE messages (
  channel_id bigint,
  bucket     int,      -- ~10 days per bucket keeps partitions under ~100 MB
  message_id bigint,   -- Snowflake: sortable by creation time
  author_id  bigint,
  content    text,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

The **Snowflake** ID is 64 bits: a 41-bit millisecond timestamp on a custom epoch (~69 years), a 10-bit machine ID (1,024 generators) and a 12-bit per-millisecond sequence (4,096 IDs).[^3] IDs are k-sorted, so "the latest 50 messages" is a single range scan in one partition.

At trillions of messages, the problem became **hot partitions**: one busy channel-bucket overloading its replicas and spreading latency across the cluster.[^6] Discord added Rust **data services** between the API and the database that coalesce concurrent requests for the same row into one query, routed by consistent hashing on `channel_id`.[^6]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Short key = hash, truncated | Stateless; any server can generate | Collisions need a check-and-retry[^2] |
| Short key = Base62 of a unique ID | No collisions | Needs an ID service; keys are guessable in sequence |
| Feed: fan-out on write | O(1) timeline reads[^4] | O(followers) writes; memory per user |
| Feed: fan-out on read | Cheap writes | Expensive merge on every read |
| Feed: hybrid | Bounded write cost for celebrities[^4] | Two code paths; ordering at serve time |
| Chat: partition by channel | One-partition reads for a conversation[^5] | Hot channels become hot partitions[^6] |
| Chat: time buckets | Bounded partition size[^5] | Reads spanning buckets need several queries |
| Request coalescing layer | Collapses duplicate hot reads[^6] | Another tier to deploy and route |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Seconds per month (estimation shortcut) | ~2.5 million; 400 req/s ≈ 1B req/month[^2] |
| Base62 key space at 7 characters | 62^7 ≈ 3.5 trillion[^2] |
| Snowflake layout | 41-bit time, 10-bit machine, 12-bit sequence[^3] |
| Snowflake target per process | ≥10,000 IDs/s at ~2 ms plus network[^3] |
| Discord messages per day, January 2017 | Over 120 million[^5] |
| Discord message cluster, early 2022 | 177 Cassandra nodes[^6] |
| After migrating to ScyllaDB | 72 nodes, 9 TB disk each (vs ~4 TB)[^6] |
| p99 historical-message read | 40–125 ms → 15 ms[^6] |
| p99 message insert | 5–70 ms → 5 ms[^6] |
| Discord migrator throughput | Up to 3.2M messages/s; est. 9 days vs 3 months for the Spark version[^6] |

## Failure modes

- **Key collisions.** Truncated hashes collide; without a uniqueness check on insert, two links share a code.[^2] Use the primary-key constraint as the arbiter and retry.
- **Celebrity fan-out.** One post from a huge account can take minutes to fan out and arrive after replies to it.[^4] Use the hybrid model and re-order at serve time.
- **Cache-miss storms.** SQL read replicas alone can't absorb timeline cache misses, and one write primary is overwhelmed at feed scale; shard, federate or move data to NoSQL.[^4]
- **Hot partitions.** A single viral channel concentrates load on a few replicas and degrades the whole cluster.[^6] Coalesce duplicate reads, rate-limit, and keep partitions bounded.
- **Unbounded partitions.** Partitioning by channel alone lets busy channels grow without limit; time buckets cap size.[^5]
- **Clock skew.** Time-based IDs depend on clocks. Snowflake recommends NTP and refuses to issue IDs if the clock moves backward.[^3]
- **Migration tails.** Discord's migration stalled at 99.9999% on uncompacted tombstones in the last token ranges and finished only after compaction.[^6]

## In the real world

- **Discord** wrote up both generations of its message store: the move from MongoDB to Cassandra (published 2017), made once data and indexes no longer fit in RAM, then Cassandra to ScyllaDB in 2022.[^5][^6]
- **Twitter's Snowflake** was built when Twitter moved from MySQL to Cassandra, which has no sequential ID facility.[^3]
- **The System Design Primer** publishes full worked solutions for Pastebin/Bit.ly, the Twitter timeline, a web crawler, Mint.com, a social graph, a key-value store for search, sales ranking and scaling on AWS.[^1]

## In a design interview

Interviewers want to see you drive the loop, not recite a diagram. A timed skeleton:[^7][^8]

1. **Requirements (≈5 min):** core features, scale, read/write ratio, latency target, what's out of scope.
2. **Entities and API (≈7 min):** `POST /urls → {code}`, `GET /{code} → 302`; `GET /feed?cursor=`; `POST /channels/{id}/messages`.
3. **High-level design (≈10–15 min):** satisfy each endpoint in turn with the simplest components.[^7]
4. **Deep dives (≈10 min):** key generation, fan-out strategy or message partitioning, whichever is the crux.
5. **Wrap up:** bottlenecks, failure handling, monitoring, the next order of magnitude.[^8]

Typical probes: *What if a code collides?* *What happens when someone with 50M followers posts?* *How do you fetch the 50 messages before a given one?* *What's your partition key and what makes it hot?*

## Check yourself

> [!question]- Why does the primer's timeline design skip fan-out for highly followed accounts?
> Fan-out is O(followers): millions of writes per post take minutes and can deliver the post after replies to it. Merging those accounts' recent posts at read time bounds write cost.

> [!question]- Discord keys messages by `((channel_id, bucket), message_id)`. What does each part buy?
> `channel_id` keeps a conversation in one place, `bucket` caps partition size at roughly 10 days of messages, and the Snowflake `message_id` orders messages by time so recent ones are a single range scan.

> [!question]- With 7 Base62 characters and 360M links, why still check for duplicates?
> The code is a truncated hash, not a counter. Collisions are unlikely given ~3.5 trillion keys but not impossible, and a silent collision redirects users to the wrong page.

## Further reading

- 📝 [The System Design Primer](https://github.com/donnemartin/system-design-primer) — the best free collection of worked case studies with estimates.
- 📝 [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages) — a real chat data model, reasoned from requirements.
- 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — the sequel: hot partitions, request coalescing and a live migration.
- 📝 [Snowflake](https://github.com/twitter-archive/snowflake/tree/snowflake-2010) — the original design notes for time-sortable 64-bit IDs.
- 🎓 [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) — how to pace a case study in an interview.

## Related

- [[High-Level Design (Deep Dive)]] — the method each case study applies.
- [[Estimation (Deep Dive)]] — the back-of-the-envelope math behind every design.
- [[Caching (Deep Dive)]] — hot links and in-memory timelines.
- [[Sharding (Deep Dive)]] — partition keys and hot partitions.
- [[NoSQL Databases (Deep Dive)]] — wide-column stores like Cassandra and ScyllaDB.
- [[Capstone - AI Support Assistant (Deep Dive)]] — a full case study for an AI system.

> [!nav] Keep going
> ← [[Low-Level Design (Deep Dive)|Low-Level Design]] · [[Projects|📁 Projects]] · [[AI System Design Overview (Deep Dive)|AI System Design Overview]] →
> 🌱 Back to the basics: [[Case Studies]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [The System Design Primer](https://github.com/donnemartin/system-design-primer) — Donne Martin, GitHub. Article. Checked 2026-11.
[^2]: 📝 [Design Pastebin.com (or Bit.ly)](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md) — Donne Martin, The System Design Primer. Article. Checked 2026-11.
[^3]: 📄 [Snowflake (2010 README)](https://github.com/twitter-archive/snowflake/tree/snowflake-2010) — Twitter, GitHub. Official docs. Checked 2026-11.
[^4]: 📝 [Design the Twitter timeline and search](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md) — Donne Martin, The System Design Primer. Article. Checked 2026-11.
[^5]: 📝 [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages) — Stanislav Vishnevskiy, Discord. Engineering blog. Checked 2026-11.
[^6]: 📝 [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) — Bo Ingram, Discord. Engineering blog. Checked 2026-11.
[^7]: 🎓 [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) — Hello Interview. Course. Checked 2026-11.
[^8]: 🎓 [A Framework for System Design Interviews](https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
