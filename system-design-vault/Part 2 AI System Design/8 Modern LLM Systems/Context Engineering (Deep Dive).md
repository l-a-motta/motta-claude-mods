---
aliases: [Context Engineering deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[Context Engineering]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[Context Engineering]] › 🔬 Deep Dive

> [!tldr] For engineers
> The context is the model's entire working memory for one call: tool definitions, system prompt, examples, retrieved data, conversation history and the output itself. Recall degrades as it grows (**context rot**, **lost in the middle**), so the goal is the **smallest set of high-signal tokens** that makes the desired output likely. The production levers are prompt structure and ordering, a few canonical examples, just-in-time retrieval, compaction and sub-agents for long tasks, and a byte-stable prefix that **prompt caching** can reuse.

> [!basics]- New to this? Start with the basics
> [[Context Engineering]] explains it with no jargon.

## How it really works

### What counts toward the window

Everything in the request counts: the system prompt, every message (including tool results, images and documents) and the tool definitions. The output generated for the turn, including extended thinking, counts too.[^1] On each turn the input carries all previous history plus the new user message, so a chat's footprint only grows unless something removes it.[^1] Most current Claude models have a 1M-token window; others, such as Claude Haiku 4.5, have 200k. An input that alone exceeds the window is rejected with a 400 "prompt is too long".[^1]

Anthropic defines context engineering as "the set of strategies for curating and maintaining the optimal set of tokens" during inference, the natural successor to prompt engineering once you build multi-turn agents rather than one-shot prompts.[^2]

### Why length hurts

A transformer lets every token attend to every other token, so n tokens create n² pairwise relationships, and models see short sequences far more often than long ones in training. The result is a finite **attention budget** that each new token draws down: a gradient of degradation, not a cliff.[^2]

Two results make this concrete:

- **Lost in the middle.** On multi-document QA and key-value retrieval, accuracy was highest when the relevant passage sat at the start or end of the input and dropped significantly in the middle, even for models built for long contexts.[^3]
- **Context rot.** Chroma tested 18 models from Anthropic, OpenAI, Google and Alibaba. Reliability fell as input grew, even on trivial tasks; distractors hurt more as length rose; and on LongMemEval every family scored significantly higher on a focused ~300-token prompt than on the full ~113k-token one.[^4]

### Anatomy of a good context

Order matters for two reasons: model accuracy and cache hits. A typical layout, stable to volatile:

```text
[tool definitions]   stable      <- cached prefix begins here
[system prompt]      stable
[reference docs]     stable-ish  <- long-form data near the top
[examples]           stable
[history]            append-only
[user query]         new every call  <- the question goes last
```

- **Long data first, question last.** Anthropic's guidance for 20k+ token inputs is to put documents above the query; queries at the end improved response quality by up to 30% in its tests.[^5] Wrap each document in tags such as `<document>` with a `<source>` so the model can tell content from instructions.[^5]
- **System prompt at the "right altitude".** Between brittle if-else rules and vague platitudes. Start minimal on the best model, then add instructions only for observed failures.[^2]
- **Examples over rules.** Few-shot prompting dates to GPT-3, where tasks and demonstrations were "specified purely via text interaction with the model" with no weight updates.[^6] Today's guidance: 3 to 5 relevant, diverse examples in `<example>` tags,[^5] chosen as canonical cases rather than a laundry list of edge cases.[^2]
- **Lean tools.** Tools should return token-efficient output and not overlap: if a human engineer can't say which tool fits, the agent can't either.[^2]

### Retrieval: up front or just in time

Classic pipelines retrieve with embeddings before inference. Agents can instead hold lightweight identifiers (file paths, stored queries, links) and load data at runtime with tools, using metadata like folder names as signal.[^2] Runtime exploration is slower and can waste tokens on dead ends, so many systems run a hybrid: a small amount loaded up front, the rest fetched on demand.[^2] For a knowledge base under about 200,000 tokens, Anthropic suggests skipping retrieval and including all of it, made affordable by caching.[^7]

### Long-horizon tasks

- **Compaction:** summarize a conversation nearing the limit and restart with the summary. Tune the summarizer for recall first, then precision. The lightest form is clearing old tool results.[^2]
- **Structured notes:** the agent writes a to-do list or `NOTES.md` outside the window and reads it back later.[^2]
- **Sub-agents:** each explores with tens of thousands of tokens in a clean window and returns a condensed 1,000–2,000-token summary to the lead agent.[^2]

### Prompt caching

The provider stores the processed state (key-value tensors) for a prompt prefix and reuses it when a later request starts with exactly the same tokens.[^8] At Anthropic the prefix order is `tools` → `system` → `messages`; changing one level invalidates it and everything after.[^9]

```json
{
  "system": [
    { "type": "text", "text": "<10k tokens of policy and reference docs>",
      "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [{ "role": "user", "content": "Can I change my flight?" }]
}
```

Up to four breakpoints are allowed per request, the default lifetime is five minutes refreshed on each hit, and a one-hour option exists.[^9] Cached tokens still occupy the window: caching changes what you pay, not what counts.[^1]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Put everything in a long context | No retrieval system; nothing missed by search | Context rot, higher cost and latency per call |
| Pre-retrieve with embeddings ([[Retrieval-Augmented Generation\|RAG]]) | Fast, predictable, scales to huge corpora | Retrieval misses; index can be stale |
| Just-in-time tool lookups | Fresh, precise, loads only what's needed | More model calls; slower; dead ends burn tokens |
| Compaction | Tasks can outlive the window | Lossy; a detail dropped now may matter later |
| Sub-agents | Clean windows, parallel exploration | More total tokens; coordination overhead |
| Long rule lists | Explicit, auditable | Brittle; models follow examples better |
| Large cached prefix | Reads at a fraction of input price | Write premium; prefix must stay byte-identical |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Claude context window | 1M tokens on most current models, 200k on others (e.g. Haiku 4.5)[^1] |
| Max output per request (1M-window Claude models) | 128k tokens[^1] |
| Quality gain from putting the query after long documents | Up to 30%[^5] |
| Recommended few-shot examples | 3–5[^5] |
| Chroma context-rot study | 18 models; focused ~300 tokens beat full ~113k[^4] |
| Sub-agent summary returned to the lead agent | 1,000–2,000 tokens[^2] |
| Anthropic cache pricing (vs base input) | Write 1.25× (5 min) or 2× (1 h); read 0.1× (0.05× or less on some newer models)[^9] |
| Anthropic minimum cacheable prefix | 512 to 4,096 tokens, by model[^9] |
| OpenAI cached-input discount | Up to 95%; 1,024-token minimum on newer models[^8] |
| OpenAI per-key routing guidance | About 15 requests per minute per `prompt_cache_key`[^8] |

Break-even arithmetic with Anthropic's default multipliers: two uncached calls cost 2.0× the prefix price; one write plus one read cost 1.25 + 0.1 = 1.35×. A prefix reused even once inside its TTL pays for itself.[^9]

## Failure modes

- **Distractor poisoning.** Even one plausible-but-wrong passage lowers accuracy compared with the relevant passage alone, four lower it further, and the damage grows with length.[^4] Defend with reranking and fewer, better chunks rather than a bigger top-k.
- **Buried facts.** Critical content in the middle of a long input gets ignored.[^3] Put long data first and the question and key constraints last.[^5]
- **Silent cache misses.** A timestamp or user ID early in the prompt, or a breakpoint on a block that changes every request, means paying a cache write on every call.[^9] Editing tool definitions invalidates the whole cache.[^9] Watch `cache_read_input_tokens` in the usage fields.[^9]
- **Overflow.** Input over the window fails outright; output that hits it stops with `model_context_window_exceeded`.[^1] Count tokens before sending and compact early.[^1]
- **Tool bloat.** Dozens of overlapping tools waste tokens and confuse selection.[^2]
- **Lossy compaction.** An aggressive summary drops the one detail needed later. Tune for recall before trimming.[^2]
- **Injected instructions.** Any document or tool result in the context can contain text that tries to steer the model; see [[Guardrails & AI Safety (Deep Dive)]].

## In the real world

- **Claude Code** loads `CLAUDE.md` files up front, uses glob and grep to pull files just in time, and on compaction keeps architectural decisions and open bugs plus the five most recently accessed files.[^2]
- **Claude playing Pokémon** kept its own notes, tracking goals across thousands of game steps outside the context window.[^2]
- **The Claude API** offers server-side compaction and context editing (tool-result and thinking-block clearing) as built-in features.[^1]
- **OpenAI** routes requests by a hash of the prompt prefix, optionally with a `prompt_cache_key`; traffic above roughly 15 requests per minute per prefix can overflow to machines without the cache.[^8]

## In a design interview

Treat the context as a budget you allocate, not a bag you fill.

1. **Inventory:** "System prompt ~2k tokens, tool schemas ~3k, retrieved docs up to 8k, last 10 turns, query."
2. **Order for caching:** "Tools and system prompt first and frozen; per-user data and the question last."
3. **Retrieval:** "Hybrid retrieval, rerank to the top few chunks; just-in-time lookups for account data."
4. **Long sessions:** "Compact at 70% of the window; persist a short task state outside it."
5. **Evaluation:** "Offline eval set to catch regressions whenever the prompt changes."

Interviewers probe: *Why not just use the 1M window?* (Context rot, cost, latency.) *How do you know a prompt change helped?* (Eval set, A/B.) *What's your cache hit rate and why?* (Prefix stability.) *What happens when a retrieved doc says "ignore your instructions"?* (Separate data from instructions; guardrails.)

## 🧱 Builds on

- [[API Design]] — the context is a request payload with a schema (tools, system, messages); versioning prompts and keeping them backward-compatible is API discipline.
- [[Caching]] — prompt caching is a prefix-keyed cache with TTLs, write costs and invalidation rules, just like cache-aside in front of a database.

## Check yourself

> [!question]- Your agent's cache hit rate is near zero although the system prompt never changes. What do you look for?
> Something volatile ahead of the breakpoint: a timestamp or user ID in the system prompt, tool definitions that are regenerated in a different order, or a breakpoint placed on the user message itself. Any change to an earlier level invalidates every later one.

> [!question]- Retrieval returns the right chunk but the model still answers wrong. Name two context-level fixes.
> Cut distractors (rerank and pass fewer chunks) and move the evidence and question to the edges of the prompt: long data at the top, the question last, so it isn't lost in the middle.

> [!question]- When would you choose sub-agents over compaction?
> When the task splits into independent explorations that each need a lot of tokens, like broad research. Each sub-agent gets a clean window and returns a short summary. Compaction suits one long, sequential back-and-forth.

## Further reading

- 📘 [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — the clearest statement of the discipline, with compaction, notes and sub-agents.
- 📘 [Context Rot](https://www.trychroma.com/research/context-rot) — careful experiments showing how 18 models degrade with input length.
- 📘 [Lost in the Middle](https://arxiv.org/abs/2307.03172) — the paper behind "put important things at the edges".
- 📘 [Prompt caching (Anthropic)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — exact invalidation rules, pricing and pitfalls.
- 📘 [Prompt caching (OpenAI)](https://developers.openai.com/api/docs/guides/prompt-caching) — how prefix-hash routing affects hit rates.

## Related

- [[Retrieval-Augmented Generation (Deep Dive)]] — chunking, hybrid search and reranking fill the context.
- [[Embeddings & Vector Databases (Deep Dive)]] — the index behind pre-retrieval.
- [[AI Agents & Tool Use (Deep Dive)]] — agents manage context across a loop of tool calls.
- [[LLM Inference & Optimization (Deep Dive)]] — KV caches and why prefill cost scales with input.
- [[Cost Optimization (Deep Dive)]] — token budgets and caching as cost levers.

> [!nav] Keep going
> ← [[Ethics & Governance (Deep Dive)|Ethics & Governance]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[Embeddings & Vector Databases (Deep Dive)|Embeddings & Vector Databases]] →
> 🌱 Back to the basics: [[Context Engineering]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) — Anthropic, Claude API documentation. Official docs. Checked 2026-11.
[^2]: 📝 [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic Engineering, 2025. Engineering blog. Checked 2026-11.
[^3]: 🔬 [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) — Liu et al., TACL 2023. Paper. Checked 2026-11.
[^4]: 📝 [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot) — Hong, Troynikov and Huber, Chroma, 2025. Technical report. Checked 2026-11.
[^5]: 📄 [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic, Claude API documentation. Official docs. Checked 2026-11.
[^6]: 🔬 [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165) — Brown et al., OpenAI, 2020. Paper. Checked 2026-11.
[^7]: 📝 [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^8]: 📄 [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) — OpenAI API documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — Anthropic, Claude API documentation. Official docs. Checked 2026-11.
