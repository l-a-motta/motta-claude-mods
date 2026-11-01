---
aliases: [Embeddings & Vector Databases deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[Embeddings & Vector Databases]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[Embeddings & Vector Databases]] › 🔬 Deep Dive

> [!tldr] For engineers
> An embedding model maps each input to a dense vector where geometric proximity approximates semantic similarity, so retrieval becomes **k-nearest-neighbor search** under cosine, dot product or L2. Exact search costs O(N·d) per query, so production systems use **approximate (ANN) indexes**: graphs (HNSW), partitions (IVF) and compression (PQ), each trading recall for latency, memory and build time. A vector database wraps the index with CRUD, metadata filtering, sharding and replication.

> [!basics]- New to this? Start with the basics
> [[Embeddings & Vector Databases]] explains it with no jargon.

## How it really works

### From input to vector

Retrieval systems use **bi-encoders**: the query and each document are embedded independently, so the corpus is embedded once, offline. The alternative, a cross-encoder that reads every pair together, does not scale: finding the most similar pair in 10,000 sentences with BERT takes about 50 million inference passes, roughly 65 hours, versus about 5 seconds with Sentence-BERT embeddings plus cosine similarity.[^1]

Model choice fixes dimensionality and input limits. OpenAI's `text-embedding-3-small` emits 1,536 dimensions and `-large` 3,072, both accepting up to 8,192 input tokens.[^2] The v3 models can be shortened with a `dimensions` parameter; vectors truncated by hand must be re-normalized.[^2]

### Distance metrics

| Metric | pgvector operator | Notes |
| --- | --- | --- |
| Cosine distance | `<=>` | Angle only; the default for text |
| Negative inner product | `<#>` | Equals cosine on unit-length vectors; cheapest |
| Euclidean (L2) | `<->` | Same ranking as cosine on unit-length vectors |

OpenAI embeddings are normalized to length 1, so cosine similarity can be computed as a plain dot product and cosine and Euclidean distance produce identical rankings.[^2] Operators are from the pgvector README.[^3]

Quality of an ANN index is measured against brute force, the "gold standard": **recall@k**, the share of true nearest neighbors the index actually returns.[^4]

### Index families

**Flat (brute force).** The only index guaranteed to be exact. No training, no parameters, and the right choice when you will run only a few thousand searches.[^5] It is also the ground truth you test every other index against.

**HNSW.** A multi-layer stack of proximity graphs over nested subsets of the data. Each element's top layer is drawn at random with exponentially decaying probability, so upper layers are sparse "express lanes". Search starts at the top and descends greedily, giving logarithmic complexity scaling; a neighbor-selection heuristic keeps recall high on clustered data.[^6] Knobs: `M` (links per node), `efConstruction` (build-time beam) and `efSearch` (query-time beam). Memory is about `d·4 + M·2·4` bytes per vector, and Faiss's HNSW does not support removal.[^5]

**IVF.** k-means splits the space into K cells; a query probes only the `nprobe` nearest cells. It needs a training step on 30·K to 256·K vectors, and for under 1M vectors Faiss suggests K between 4·√N and 16·√N.[^5]

**Product quantization (PQ).** Split each vector into segments, learn a k-means codebook per segment, store only the code indices.[^7] In Meta's billion-scale example, Faiss stores each vector as a 20-byte PQ code, arguing that compression is the only approach that reaches billions of vectors.[^4]

At scale these compose. Faiss recommends `IVF65536_HNSW32` (HNSW to assign IVF cells) for 1M–10M vectors and `IVF1048576_HNSW32` for 100M–1B.[^5]

### In Postgres with pgvector

```sql
CREATE EXTENSION vector;
CREATE TABLE docs (id bigserial PRIMARY KEY, tenant_id int, body text, embedding vector(1536));
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
SET hnsw.ef_search = 100;  -- default 40; higher = better recall, slower
SELECT id, body FROM docs WHERE tenant_id = 42 ORDER BY embedding <=> $1 LIMIT 10;
```

Search is exact until you add an index; after that, "you will see different results for queries".[^3] HNSW defaults are `m = 16`, `ef_construction = 64` and `ef_search = 40`; it has no training step, so it can be built on an empty table. IVFFlat must be built after loading data, with `lists ≈ rows/1000` up to 1M rows and `probes` starting near `√lists`.[^3]

### What a "vector database" adds

A standalone index such as Faiss does search. A database adds inserts, updates and deletes, metadata storage and filtering, namespaces for multitenancy, backups and access control.[^7] At scale, data is sharded across nodes, queries scatter to every shard and the results are merged, and replicas provide fault tolerance.[^7]

## Design choices and trade-offs

| Index | Recall vs speed | Memory | Build | Updates | Use when |
| --- | --- | --- | --- | --- | --- |
| Flat | Exact, O(N) per query | Raw vectors | None | Trivial | Small sets, few queries, ground truth |
| HNSW | Best speed-recall trade-off | Raw + graph links | Slow, memory-hungry | Inserts fine; deletes awkward | Latency-critical, fits in RAM |
| IVF-Flat | Good; tune `nprobe` | Raw vectors | Fast, needs training | Cells drift as data shifts | Large sets, cheaper builds |
| IVF-PQ | Lower; tune code size | Tens of bytes per vector | Training needed | Retrain on drift | 100M+ vectors, tight RAM |

| Platform | Gains | Costs |
| --- | --- | --- |
| pgvector in Postgres | ACID, JOINs, point-in-time recovery, one system to run[^3] | Index dimension caps; scaling is your job |
| Dedicated vector DB | Managed sharding, serverless storage/compute split[^7] | Another system; sync with your source of truth |

Pre-filtering narrows the search space but can miss relevant matches; post-filtering keeps recall but costs extra work.[^7]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| OpenAI embedding dimensions | 1,536 (3-small), 3,072 (3-large); 8,192-token input[^2] |
| MTEB score, 3-small / 3-large / ada-002 | 62.3% / 64.6% / 61.0%[^2] |
| 3-large shortened to 256 dims vs ada-002 at 1,536 | Shortened model still scores higher[^2] |
| Raw float32 storage | `d × 4` bytes (the `d·4` term in Faiss's HNSW formula[^5]), so 1M × 1,536 dims ≈ 6.1 GB before index overhead |
| HNSW memory per vector | About `d·4 + M·2·4` bytes[^5] |
| pgvector max indexable dimensions | 2,000 (`vector`), 4,000 (`halfvec`)[^3] |
| Faiss on 1B vectors (Deep1B, 30 GB RAM) | 40% 1-recall@1 in under 2 ms/query on one core[^4] |
| Faiss GPU speedup | Typically 5–10× over CPU[^4] |
| Cross-encoder vs bi-encoder, 10k sentences | ~65 hours vs ~5 seconds[^1] |
| Spotify Voyager vs Annoy | Over 10× faster at equal recall; up to 4× less memory[^8] |

## Failure modes

- **Filtered queries return too few rows.** With an approximate index, pgvector applies the `WHERE` after the index scan, so a selective filter can leave fewer than `LIMIT` results. Defend with iterative index scans, partial indexes for a few filter values, or partitioning for many.[^3]
- **Silent recall loss.** Approximate results differ from exact ones.[^3] Sample queries, run brute force offline, and track recall@k like any SLO.[^4]
- **Exact-term misses.** Embeddings can miss literal identifiers; Anthropic's example is an error code like "TS-999". Combine with BM25 keyword search.[^9]
- **Model upgrades.** Vectors from different models live in different spaces, so a new model means re-embedding the whole corpus. Run old and new indexes side by side and cut over.
- **Memory blowups.** HNSW builds fastest when the graph fits in `maintenance_work_mem`, but setting it too high can exhaust the server.[^3] Use `halfvec` or quantization to shrink vectors.[^3]
- **Stale IVF cells.** Centroids are learned from the data at build time,[^5] so an index built on a small or early sample degrades as data grows. Build after loading and rebuild periodically.[^3]

## In the real world

- **Meta (Faiss)** built the first k-NN graph over 1 billion vectors, reported billion-scale search 8.5× faster than the prior state of the art, and leans on compressed codes.[^4] The 2024 Faiss paper describes it as a toolkit to "search, cluster, compress and transform vectors".[^10]
- **Spotify (Voyager)** uses nearest-neighbor search across personalization, recommendation and search, including Discover Weekly and Home. Voyager is built on hnswlib, uses 8-bit E4M3 floats to cut memory, and has served production traffic since 2022.[^8]
- **pgvector** brings vector search into Postgres, next to relational data.[^3]
- **Pinecone** separates storage from compute and adds a freshness layer so new vectors become searchable quickly.[^7]

## In a design interview

Size it first, then pick the index.

1. **Volume:** "50M chunks × 768 dims × 4 bytes ≈ 154 GB raw. HNSW on one node is out."
2. **Index:** "IVF-PQ shards, or HNSW over `halfvec` across several shards; target recall@10 ≥ 0.95."
3. **Filtering:** "Tenant ID on every query: partition by tenant, or rely on iterative scans."
4. **Freshness:** "New docs embedded by a queue consumer; searchable within minutes."
5. **Quality:** "Hybrid with BM25; nightly brute-force recall check on a sample."

Interviewers probe: *Why not just Postgres?* (Fine until index size or QPS outgrows a node.) *How do you handle deletes in HNSW?* (Tombstones and periodic rebuilds.) *What happens when you change embedding models?* (Full re-embed, dual index, cutover.) *How do you know results are good?* (Recall vs brute force, plus task-level evals.)

## 🧱 Builds on

- [[Data Structures]] — HNSW is a layered graph akin to a skip list; top-k results come from a bounded priority queue.
- [[Databases]] — an ANN index is a secondary index with a new distance-based access path, plus the usual WAL, backups and transactions in pgvector.
- [[NoSQL Databases]] — dedicated vector stores trade relational features for one optimized access pattern and horizontal scale.
- [[Sharding]] — vectors are partitioned across nodes; queries scatter to all shards and merge top-k results.[^7]

## Check yourself

> [!question]- Your HNSW index returns only 3 rows for `WHERE tenant_id = 42 ... LIMIT 10`. Why, and what are the fixes?
> The filter is applied after the approximate scan, which only considered `ef_search` candidates, most from other tenants. Raise `ef_search`, enable iterative index scans, or use a partial index or a partition per large tenant.

> [!question]- Why do cosine, dot product and L2 give the same ranking for OpenAI embeddings?
> They are normalized to unit length. For unit vectors, the dot product equals cosine similarity, and squared L2 distance equals 2 minus twice the dot product, so all three order neighbors identically.

> [!question]- When would you choose IVF-PQ over HNSW?
> When the collection is too large to keep raw vectors plus graph links in RAM, such as hundreds of millions of vectors. PQ stores tens of bytes per vector, at the cost of some recall and a training step.

## Further reading

- 📘 [Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320) — the original HNSW paper; short and readable.
- 📘 [Guidelines to choose an index](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index) — the most practical decision guide by dataset size and memory budget.
- 📘 [pgvector README](https://github.com/pgvector/pgvector) — every operator, index option and filtering caveat for Postgres.
- 📘 [The Faiss library](https://arxiv.org/abs/2401.08281) — a 2024 tour of vector search trade-offs from the Faiss team.
- 📘 [Sentence-BERT](https://arxiv.org/abs/1908.10084) — why bi-encoders made semantic search practical.

## Related

- [[Retrieval-Augmented Generation (Deep Dive)]] — hybrid search, reranking and chunking on top of this index.
- [[Context Engineering (Deep Dive)]] — what to do with the retrieved chunks.
- [[Sharding (Deep Dive)]] — partitioning schemes behind scatter-gather search.
- [[SQL Databases (Deep Dive)]] — where pgvector runs.
- [[Data Structures (Deep Dive)]] — graphs, heaps and skip lists.
- [[Feature Engineering (Deep Dive)]] — embeddings as learned features.

> [!nav] Keep going
> ← [[Context Engineering (Deep Dive)|Context Engineering]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[Retrieval-Augmented Generation (Deep Dive)|Retrieval-Augmented Generation]] →
> 🌱 Back to the basics: [[Embeddings & Vector Databases]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks](https://arxiv.org/abs/1908.10084) — Reimers and Gurevych, EMNLP 2019. Paper. Checked 2026-11.
[^2]: 📄 [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings) — OpenAI API documentation. Official docs. Checked 2026-11.
[^3]: 📄 [pgvector](https://github.com/pgvector/pgvector) — pgvector project README on GitHub. Official docs. Checked 2026-11.
[^4]: 📝 [Faiss: A library for efficient similarity search](https://engineering.fb.com/2017/03/29/data-infrastructure/faiss-a-library-for-efficient-similarity-search/) — Engineering at Meta, 2017. Engineering blog. Checked 2026-11.
[^5]: 📄 [Guidelines to choose an index](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index) — Faiss wiki, Meta. Official docs. Checked 2026-11.
[^6]: 🔬 [Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320) — Malkov and Yashunin, 2016–2018. Paper. Checked 2026-11.
[^7]: 📝 [What is a Vector Database & How Does it Work?](https://www.pinecone.io/learn/vector-database/) — Roie Schwaber-Cohen, Pinecone, 2023. Article. Checked 2026-11.
[^8]: 📝 [Introducing Voyager: Spotify's New Nearest-Neighbor Search Library](https://engineering.atspotify.com/introducing-voyager-spotifys-new-nearest-neighbor-search-library) — Spotify Engineering, 2023. Engineering blog. Checked 2026-11.
[^9]: 📝 [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^10]: 🔬 [The Faiss library](https://arxiv.org/abs/2401.08281) — Douze et al., 2024. Paper. Checked 2026-11.
