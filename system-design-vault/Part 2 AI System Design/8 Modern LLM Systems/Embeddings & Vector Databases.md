---
aliases: [embeddings, vector database, vector search, semantic search, ANN, HNSW, pgvector]
tags: [level/basics, part/2, section/modern-llm-systems]
level: Basics
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
deep_dive: "[[Embeddings & Vector Databases (Deep Dive)]]"
reading_time: 4 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › Embeddings & Vector Databases

> [!tldr] In one sentence
> An embedding turns text, an image or a song into a list of numbers so that **similar things land close together**, and a vector database stores millions of these lists and **finds the closest ones fast**.

## 🧠 Think of it like…

> [!analogy] A record store sorted by sound
> Picture a store where albums are shelved by how they sound, not by name. Calm jazz sits next to lo-fi beats; heavy metal is across the room. To find albums like the one in your hand, you walk to its spot and look at its neighbors.

An **embedding** is an album's spot, written as numbers. A **vector database** is the store plus a fast way to find neighbors. "Similar" becomes "nearby", which computers measure easily.

## What it is

An **embedding model** is an AI model that reads something and outputs a **vector**, a fixed-length list of numbers. One popular text model turns any sentence into 1,536 numbers.[^1] The distance between two vectors measures how related the inputs are: small distance, high relatedness.[^1]

Meaning, not spelling, decides closeness. "How do I reset my password?" and "I forgot my login" share almost no words, yet their vectors sit near each other. Such word vectors could already be learned from 1.6 billion words in under a day in 2013.[^2]

A **vector database** stores these vectors and answers one question fast: "which items are nearest to this one?" That is **semantic search**.

## Why it matters

- **Search by meaning.** Users rarely type your documents' exact words. Embeddings match anyway.
- **One tool, many uses.** The same vectors power search, recommendations, grouping and spotting odd items.[^1]
- **It feeds AI assistants.** Chatbots use it to find pages before answering.
- **Speed.** Comparing 10,000 sentences pair by pair with a heavy model took about 65 hours; with embeddings, about 5 seconds.[^3]

## How it works

```mermaid
flowchart LR
    D["Your documents"] --> E["Embedding model"]
    E --> V["Vectors"]
    V --> I["Vector database index"]
    Q["User's search"] --> E2["Same embedding model"]
    E2 --> QV["Query vector"]
    QV --> I
    I --> R["Closest matches"]
```

1. **Embed once.** Turn every document into a vector and store it.
2. **Embed the question.** Turn the search into a vector with the same model.
3. **Find the neighbors.** Return the stored vectors closest to the query.

Checking every vector is exact but slow at scale, so most systems use **approximate nearest neighbor (ANN)** search: an index that checks only a small part of the data, trading a little accuracy for a lot of speed.[^4]

The popular **HNSW** index links vectors into a layered network.[^5] Think highways and local streets: a search starts on sparse top layers with long links, gets close quickly, then takes local streets.[^5]

## A real-world example

Spotify uses nearest-neighbor search for recommendations and search, including Discover Weekly.[^6] In 2023 it open-sourced Voyager, its HNSW-based library. Spotify says Voyager is more than 10 times faster than its older tool at the same accuracy, with up to 4 times less memory.[^6]

## Myths and pitfalls

- **❌ Myth:** You need a special new database. **✅ Reality:** The pgvector add-on lets Postgres, a common database, search vectors too.[^7]
- **❌ Myth:** Vector search always returns the true closest matches. **✅ Reality:** Fast indexes are approximate, so results can differ from an exact search.[^7]
- **❌ Myth:** Meaning-based search makes keyword search obsolete. **✅ Reality:** Embeddings can miss exact strings like an error code, so many systems use both.[^8]
- **❌ Myth:** Longer vectors are always better. **✅ Reality:** A newer model cut to 256 numbers beat an older one's 1,536.[^1]

## Check yourself

> [!question]- Why can "I forgot my login" match a page titled "Resetting your password"?
> They mean similar things, so their vectors land close together.

> [!question]- Why not compare the query with every stored vector?
> It is exact but too slow for millions of items. ANN indexes like HNSW check only a small part of the data.

> [!question]- Documents are embedded with one model and questions with another. What goes wrong?
> Each model draws its own "map", so distances between them mean nothing.

## Key terms

- **Embedding** — a list of numbers that captures what something means.
- **Semantic search** — finding results by meaning rather than exact words.
- **Nearest neighbor** — the stored item whose vector is closest to the query.
- **ANN** — approximate nearest neighbor search: fast, nearly exact.
- **HNSW** — a popular ANN index built as a layered network of links.
- **Vector database** — a database built to store vectors and find neighbors quickly.

## 🧱 Builds on

- [[Data Structures]] — HNSW is a layered graph, much like a skip list.
- [[Databases]] — a vector database still needs storage, updates and backups.
- [[NoSQL Databases]] — many vector stores are non-relational, tuned for one access pattern.
- [[Sharding]] — billions of vectors are split across machines, and results from each are merged.[^9]

> [!deepdive] Ready for the technical take?
> Distance metrics, HNSW and IVF internals, product quantization, filtered search, pgvector tuning and index sizing.
> → [[Embeddings & Vector Databases (Deep Dive)]]

## Related

- [[Retrieval-Augmented Generation]] — the biggest user of vector search today.
- [[Context Engineering]] — what happens to documents once found.
- [[SQL Databases]] — where pgvector lives.

> [!nav] Keep going
> ← [[Context Engineering]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[Retrieval-Augmented Generation]] →
> 🔬 Technical take: [[Embeddings & Vector Databases (Deep Dive)]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings) — OpenAI API documentation. Official docs. Checked 2026-11.
[^2]: 🔬 [Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/abs/1301.3781) — Mikolov et al., Google, 2013. Paper. Checked 2026-11.
[^3]: 🔬 [Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks](https://arxiv.org/abs/1908.10084) — Reimers and Gurevych, EMNLP 2019. Paper. Checked 2026-11.
[^4]: 📝 [Faiss: A library for efficient similarity search](https://engineering.fb.com/2017/03/29/data-infrastructure/faiss-a-library-for-efficient-similarity-search/) — Engineering at Meta, 2017. Engineering blog. Checked 2026-11.
[^5]: 🔬 [Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320) — Malkov and Yashunin, 2016–2018. Paper. Checked 2026-11.
[^6]: 📝 [Introducing Voyager: Spotify's New Nearest-Neighbor Search Library](https://engineering.atspotify.com/introducing-voyager-spotifys-new-nearest-neighbor-search-library) — Spotify Engineering, 2023. Engineering blog. Checked 2026-11.
[^7]: 📄 [pgvector](https://github.com/pgvector/pgvector) — pgvector project README on GitHub. Official docs. Checked 2026-11.
[^8]: 📝 [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^9]: 📝 [What is a Vector Database & How Does it Work?](https://www.pinecone.io/learn/vector-database/) — Roie Schwaber-Cohen, Pinecone, 2023. Article. Checked 2026-11.
