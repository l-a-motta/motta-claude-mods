---
aliases: [Retrieval-Augmented Generation deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[Retrieval-Augmented Generation]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[Retrieval-Augmented Generation]] › 🔬 Deep Dive

> [!tldr] For engineers
> RAG pairs a **retriever** (non-parametric memory: an index over your corpus) with a **generator** (the LLM's parametric memory). Answer quality is capped by retrieval recall, so most of the engineering lives upstream: chunking, hybrid lexical-plus-dense search fused by rank, cross-encoder reranking, and enriching chunks with context. Anthropic cut top-20 retrieval failures from 5.7% to 1.9% by stacking those techniques. Evaluate retrieval and generation separately, and treat the index as a pipeline that must stay fresh and permission-aware.

> [!basics]- New to this? Start with the basics
> [[Retrieval-Augmented Generation]] explains it with no jargon.

## How it really works

### Where it comes from

Lewis et al. (NeurIPS 2020) combined a pre-trained seq2seq model as **parametric memory** with a dense vector index of Wikipedia, accessed by a neural retriever, as **non-parametric memory**. They compared conditioning the whole output on one set of passages against picking passages per token, set state-of-the-art results on three open-domain QA tasks, and produced more specific, diverse and factual text than a parametric-only baseline.[^1] The later survey by Gao et al. groups the field into Naive, Advanced and Modular RAG, built from three parts: retrieval, augmentation and generation.[^2]

### Offline: building the index

1. **Parse and chunk.** Fixed-size chunks are the recommended starting point; recursive splitting tries paragraph breaks, then line breaks, then spaces; structure-aware splitting follows Markdown headings or LaTeX sections; semantic chunking cuts where adjacent sentence groups' embeddings diverge.[^3] Text beyond the embedding model's input limit may be truncated and silently lost.[^3]
2. **Contextualize (optional).** Plain chunks lose meaning: "revenue grew by 3%" doesn't say which company or quarter. **Contextual retrieval** has an LLM write 50–100 tokens situating each chunk in its document and prepends them before embedding and keyword indexing.[^4]
3. **Index twice.** Embed chunks into a vector index and build a **BM25** index, a TF-IDF-style lexical ranking with length normalization and term-frequency saturation that excels at exact strings such as an error code.[^4]
4. **Store metadata.** Source URL, timestamps and access-control groups travel with each chunk so you can cite and filter.

### Online: answering a question

```python
def answer(question, user):
    filters = {"acl": user.groups}                        # never retrieve what the user can't read
    dense  = vector_index.search(embed(question), k=150, filters=filters)
    sparse = bm25_index.search(question, k=150, filters=filters)
    fused  = reciprocal_rank_fusion([dense, sparse], k=60)
    top    = cross_encoder.rerank(question, fused[:150])[:20]
    prompt = render(documents=top, question=question)    # documents first, question last
    return llm.generate(prompt, cite=True)
```

**Rank fusion.** BM25 scores have no upper bound while cosine scores fall in a fixed range, so raw scores can't be compared. **Reciprocal Rank Fusion** scores each document as the sum of `1/(rank + k)` over every list it appears in, with `k` around 60, rewarding items ranked high in several lists.[^5]

**Reranking.** The retriever is a bi-encoder: fast, because document vectors are precomputed, but it never sees the query and document together. A **cross-encoder** reads both at once and outputs a relevance score, which is more accurate but too slow for the whole corpus, so it only rescores the retriever's candidates (about 100 in the Sentence Transformers example).[^6] Anthropic retrieved 150, reranked, and passed the top 20.[^4]

**Assembly.** Models use evidence at the start and end of long inputs best and lose it in the middle,[^7] so put documents first, the question last, and keep the chunk count modest. See [[Context Engineering (Deep Dive)]].

### Evaluating it

Measure the two halves separately. Retrieval: recall@k against labeled question-to-chunk pairs; Anthropic reports `1 − recall@20`.[^4] Generation: faithfulness to the retrieved text, answer relevance, and citation correctness, usually scored by humans plus an LLM judge. DoorDash built a framework running thousands of automated tests per hour, a 50× increase in testing capacity.[^8]

## Design choices and trade-offs

| Decision | Option | Gains | Costs |
| --- | --- | --- | --- |
| Chunk size | Small (128–256 tokens)[^3] | Precise matches | Loses surrounding context |
| Chunk size | Large (512–1,024 tokens)[^3] | More context per hit | Diluted meaning, more tokens |
| Retrieval | Dense only | Synonyms, paraphrase | Misses exact IDs and codes |
| Retrieval | Hybrid BM25 + dense with RRF | Best of both[^4] | Two indexes to maintain |
| Reranking | Cross-encoder over top 100–150 | Large recall gain[^4] | Added latency[^4]; one more model call per query |
| Chunks passed | 5 vs 10 vs 20 | 20 won in Anthropic's tests[^4] | More tokens, more distraction |
| Contextual chunks | LLM-written prefix per chunk | Fewer misses[^4] | One-time indexing cost |
| No RAG | Whole corpus in prompt | Simplest; nothing to miss | Only for small corpora[^4] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Top-20 retrieval failure, baseline embeddings | 5.7%[^4] |
| + contextual embeddings | 3.7% (−35%)[^4] |
| + contextual BM25 | 2.9% (−49%)[^4] |
| + reranking | 1.9% (−67%)[^4] |
| Contextual prefix length | 50–100 tokens[^4] |
| Cost to contextualize, with prompt caching | About $1.02 per million document tokens[^4] |
| Corpus size where you can skip RAG | Under ~200,000 tokens (~500 pages)[^4] |
| Prompt caching effect for that approach | Latency down over 2×, cost down up to 90%[^4] |
| RRF constant `k` | About 60[^5] |
| Azure AI Search default hybrid result size | Top 50; full-text side capped at 1,000 matches[^5] |
| DoorDash voice RAG latency | 2.5 seconds or less[^8] |

## Failure modes

- **Retrieval misses.** The right chunk isn't in the top-k, and the model answers from whatever it got. Track recall@k; add BM25, contextual chunks and reranking.[^4]
- **Orphaned chunks.** A chunk that only makes sense with its neighbors won't surface for the right query.[^3] Use structure-aware splits, contextual prefixes, or expand to neighboring chunks after retrieval.[^3]
- **Distractors.** Plausible but irrelevant chunks lower accuracy, and the effect grows with input length.[^9] Rerank and pass fewer chunks.
- **Lost in the middle.** Evidence buried mid-prompt gets ignored.[^7]
- **Stale or leaky index.** Deleted or edited documents linger until re-indexed, and an index without per-chunk ACLs will happily retrieve what the user may not read. Filter by permission at query time; see [[Authorization (Deep Dive)]].
- **Injected instructions.** Retrieved pages can contain text aimed at the model; treat them as data. See [[Guardrails & AI Safety (Deep Dive)]].
- **Latency stacking.** Embedding, two searches, reranking and generation run in sequence; reranking in particular adds latency, so tune how many candidates you rescore.[^4]

## In the real world

- **DoorDash** indexed its public help center with Knowledge Bases for Amazon Bedrock, which handled ingestion, retrieval and prompt augmentation, and used Claude 3 Haiku for speed. The voice assistant answers within 2.5 seconds, fields hundreds of thousands of calls a day, and cut escalations to live agents by thousands per day.[^8]
- **Anthropic** published contextual retrieval with a cookbook implementation and found Gemini and Voyage embeddings performed best in its tests.[^4]
- **Azure AI Search** runs keyword and vector queries in parallel, fuses them with RRF, then optionally applies a semantic reranker on the fused list.[^5]
- **The original RAG** used Wikipedia as its non-parametric memory.[^1]

## In a design interview

Draw two pipelines, ingest and query, and say where quality is measured.

1. **Ingest:** "Docs land in object storage; a queue triggers parse, chunk at ~500 tokens with headings, contextualize, embed, BM25-index, with ACLs."
2. **Query:** "Hybrid top-150 with RRF, cross-encoder rerank to 10–20, documents-first prompt, answer with chunk citations."
3. **Quality:** "Golden set of 300 questions; recall@20 for retrieval, LLM-judge faithfulness for answers, run on every change."
4. **Scale and cost:** "Cache the stable prompt prefix; cache embeddings of frequent queries."

Interviewers probe: *Why not fine-tune instead?* (Facts change; RAG updates by re-indexing and can cite.) *How do you handle a doc that's deleted?* (Delete by source ID in both indexes; freshness SLO.) *How do you stop users seeing others' data?* (ACL filters at retrieval.) *When is RAG overkill?* (Corpus fits in the window.)

## 🧱 Builds on

- [[Databases]] — the vector and BM25 indexes are derived data; keep them in sync with the source of truth by ID, like any secondary index or search replica.
- [[Caching]] — prompt caching makes per-chunk contextualization and "whole corpus in the prompt" affordable;[^4] query-embedding caches cut repeat cost.
- [[API Design]] — the answer endpoint returns structured citations alongside text, often streamed, and versions its retrieval behavior.

## Check yourself

> [!question]- Why fuse BM25 and dense results by rank instead of adding their scores?
> Their scores live on different scales: BM25 is unbounded and depends on the query, cosine sits in a fixed range. RRF uses only positions, so neither list dominates by accident.

> [!question]- Recall@20 is 98%, but users still get wrong answers. Where do you look next?
> At generation: are the right chunks buried mid-prompt among distractors, is the chunk count too high, does the prompt demand answers only from context, and does the judge flag unfaithful answers? Also check whether the golden set reflects real queries.

> [!question]- Your corpus is 120 pages of policy that changes monthly. Do you build RAG?
> Probably not. At roughly 500 pages or fewer you can put the whole corpus in the prompt and cache it, which removes retrieval misses entirely.

## Further reading

- 📘 [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) — the paper that named RAG.
- 📘 [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — the best measured comparison of hybrid search, contextual chunks and reranking.
- 📘 [RAG for Large Language Models: A Survey](https://arxiv.org/abs/2312.10997) — a map of the whole design space.
- 📘 [Retrieve & Re-Rank](https://www.sbert.net/examples/applications/retrieve_rerank/README.html) — bi-encoders vs cross-encoders, with runnable examples.
- 📘 [Hybrid search scoring (RRF)](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) — a precise description of rank fusion in production.

## Related

- [[Embeddings & Vector Databases (Deep Dive)]] — the dense half of retrieval.
- [[Context Engineering (Deep Dive)]] — assembling retrieved chunks into the prompt.
- [[Evaluation & Metrics (Deep Dive)]] — recall@k, faithfulness and LLM judges.
- [[Data Engineering & Pipelines (Deep Dive)]] — the ingest pipeline that keeps the index fresh.
- [[Capstone - AI Support Assistant (Deep Dive)]] — RAG inside a complete support system.

> [!nav] Keep going
> ← [[Embeddings & Vector Databases (Deep Dive)|Embeddings & Vector Databases]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[LLM Inference & Optimization (Deep Dive)|LLM Inference & Optimization]] →
> 🌱 Back to the basics: [[Retrieval-Augmented Generation]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) — Lewis et al., NeurIPS 2020. Paper. Checked 2026-11.
[^2]: 🔬 [Retrieval-Augmented Generation for Large Language Models: A Survey](https://arxiv.org/abs/2312.10997) — Gao et al., 2023–2024. Paper. Checked 2026-11.
[^3]: 📝 [Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/) — Schwaber-Cohen and Patel, Pinecone, 2025. Article. Checked 2026-11.
[^4]: 📝 [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^5]: 📄 [Hybrid search scoring (RRF)](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) — Microsoft Learn, Azure AI Search. Official docs. Checked 2026-11.
[^6]: 📄 [Retrieve & Re-Rank](https://www.sbert.net/examples/applications/retrieve_rerank/README.html) — Sentence Transformers documentation. Official docs. Checked 2026-11.
[^7]: 🔬 [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) — Liu et al., TACL 2023. Paper. Checked 2026-11.
[^8]: 📝 [Building a Generative AI Contact Center Solution for DoorDash Using Amazon Bedrock, Amazon Connect and Anthropic's Claude](https://aws.amazon.com/solutions/case-studies/doordash-bedrock-case-study/) — Amazon Web Services case study. Article. Checked 2026-11.
[^9]: 📝 [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot) — Hong, Troynikov and Huber, Chroma, 2025. Technical report. Checked 2026-11.
