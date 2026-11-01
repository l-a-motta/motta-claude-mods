---
aliases: [Cost Optimization deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Cost Optimization]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Cost Optimization]] › 🔬 Deep Dive

> [!tldr] For engineers
> Managed-API cost is `tokens × price`, with output tokens priced around 5× input; self-hosted cost is `GPU-hours ÷ useful tokens`, so utilization is everything. The big levers, roughly in order of impact: **right-size and route**, **cache repeated prefixes**, **batch what can wait**, **shrink the model** (distill, quantize), **raise GPU utilization**, and **buy cheaper capacity** (spot, global routing). Track cost per successful outcome, not per token, or you will optimize the wrong thing.

> [!basics]- New to this? Start with the basics
> [[Cost Optimization]] explains it with no jargon.

## How it really works

### Two cost models

**Managed APIs** bill per token, with separate prices for input, output, cache writes and cache reads. On Anthropic's current price list, Claude Sonnet 5.5 is $2 per million input tokens and $10 per million output tokens; Claude Haiku 5.5 is $0.10 and $0.50; Claude Opus 5.5 is $4 and $20.[^1] Output is 5× input on all three, and Opus costs 40× Haiku per input token.[^1] The spread is wider at the edges: Claude Fable 5.1 lists at $10 / $50, and Haiku 5.5 prompts over 100,000 tokens are billed at five times its base rates.[^1]

**Self-hosted models** bill by uptime: instance-hours plus storage and network, whether the GPU is busy or idle.[^2] Cost per token is then the hourly price divided by the tokens you actually serve per hour, which makes batching and memory efficiency direct cost levers.

```python
def request_cost(inp, out, cached=0, p_in=2.00, p_out=10.00, read_mult=0.05):
    """USD per request; prices are per million tokens (Sonnet 5.5 list prices)."""
    fresh = inp - cached
    return (fresh * p_in + cached * p_in * read_mult + out * p_out) / 1e6

request_cost(21_000, 500)                  # 0.047  no caching
request_cost(21_000, 500, cached=20_000)   # 0.009  20k-token system prompt cached
```

A 20k-token system prompt reused on every call turns a $0.047 request into a $0.009 one. That is the shape of most AI cost work: find the tokens you pay for repeatedly and stop paying full price for them.

### Lever 1: right-size the model and route

AWS's Generative AI Lens recommends testing the smallest model first and moving up only until quality meets the bar, re-evaluating as new models ship, and routing simpler requests to smaller models.[^2] It also points out that real-time inference is often unnecessary, and batch is cheaper.[^2]

A **router** makes the choice per request. LMSYS's RouteLLM trains routers on Chatbot Arena preference data to predict whether the strong model would win on a given prompt.[^3] With GPT-4 Turbo as the strong model and Mixtral 8x7B as the weak one, it cut cost by over 85% on MT Bench, 45% on MMLU and 35% on GSM8K versus GPT-4 alone, while keeping 95% of GPT-4's performance.[^3] The routers transferred to a Claude 3 Opus / Llama 3 8B pair without retraining.[^3]

### Lever 2: cache repeated prefixes

**Prompt caching** stores the processed prefix of a prompt (system prompt, tool definitions, a long document) so later requests that share it skip recomputation. On Anthropic's API, a 5-minute cache write costs 1.25× base input, a 1-hour write costs 2×, and a read costs 0.1× (0.05× on Opus 5.5 and Sonnet 5.5).[^4] The 5-minute cache pays for itself after one read, the 1-hour cache after two.[^1] The TTL is refreshed at no cost each time the entry is used, and prompts below a model-specific minimum (512 to 4,096 tokens) are silently not cached.[^4]

Design rule: put stable content first and volatile content (user turn, timestamps) last, because only an identical prefix hits. Whole-answer or semantic caches are the [[Caching (Deep Dive)|classic cache-aside pattern]] applied to model outputs; they save more per hit but risk serving a stale or wrong answer to a merely similar question.

### Lever 3: batch what can wait

OpenAI's Batch API gives a 50% discount, completes within 24 hours, accepts up to 50,000 requests or 200 MB per batch, and draws from a separate rate-limit pool.[^5] Anthropic's batch discount is also 50% on input and output and stacks with prompt caching.[^1] Evaluations, backfills, embeddings of a document corpus and nightly classification belong here.

### Lever 4: shrink the model

**Distillation** compresses a large model's (or ensemble's) knowledge into a smaller one that is much easier to deploy.[^6] DistilBERT is the textbook result: 40% smaller and 60% faster than BERT while retaining 97% of its language-understanding performance.[^7]

**Quantization** stores weights in fewer bits. LLM.int8() halved inference memory versus 16-bit weights with no measured degradation on models up to 175B parameters, enough to fit OPT-175B on a single server of consumer GPUs.[^8] Lower precision means fewer or cheaper GPUs per replica.

### Lever 5: raise GPU utilization

Self-hosted cost falls as throughput per GPU rises. The KV cache, which grows and shrinks per request, is the usual bottleneck: fragmentation and duplication waste memory and cap batch size.[^9] vLLM's PagedAttention manages it like virtual-memory pages and raised throughput 2–4× over FasterTransformer and Orca at similar latency.[^9] See [[LLM Inference & Optimization (Deep Dive)]] for continuous batching and speculative decoding.

For spiky, low-volume traffic, scale-to-zero beats an always-on endpoint. SageMaker Serverless Inference scales to zero between bursts, at the price of cold starts, but it does not support GPUs.[^10] So it fits small CPU models, not LLMs.

### Lever 6: buy cheaper capacity

**Spot instances** sell spare EC2 capacity at up to 90% off on-demand prices.[^11] EC2 sends an interruption notice two minutes before stopping or terminating the instance, via EventBridge and instance metadata, and recommends polling every 5 seconds.[^12] Training jobs that checkpoint frequently can absorb this; latency-sensitive serving usually cannot. On Amazon Bedrock, global cross-Region inference costs roughly 10% less than geographic profiles, in exchange for giving up data-residency guarantees.[^13]

### FinOps: the operating model

**FinOps** combines financial management with engineering and operations; Microsoft's guide stresses that its goal "isn't to save money" but to maximize business value, through cost visibility, allocation to teams and cross-functional decisions.[^14] For AI, that means tagging spend per feature and model, and reporting **cost per successful outcome** (per resolved ticket, per accepted summary) next to quality metrics.

## Design choices and trade-offs

| Choice | Saves | Costs you |
| --- | --- | --- |
| Smaller model everywhere | Most of the token bill | Quality on hard cases |
| Router between small and large | 35–85% in published tests | A router to train, evaluate and monitor |
| Prompt caching | Up to 90% on cached input | Prompt layout discipline; write premium on misses |
| Semantic answer cache | Whole model calls | Wrong or stale answers to near-duplicate questions |
| Batch API | 50% | Up to 24 h latency |
| Distillation | Inference compute | Training effort; some quality loss |
| Quantization | GPU memory, GPU count | Possible accuracy loss at aggressive bit widths |
| Spot capacity | Up to 90% of compute | Interruptions; needs checkpointing |
| Scale-to-zero | Idle cost | Cold starts |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Output vs input token price (Claude 5.5 family) | 5×[^1] |
| Largest vs smallest Claude 5.5 model, per input token | $4 vs $0.10 per MTok (40×)[^1] |
| Cache read price | 0.1× base input; 0.05× on Opus 5.5 and Sonnet 5.5[^4] |
| Cache write premium | 1.25× (5 min) or 2× (1 h)[^4] |
| Prompt caching, 100k-token "chat with a book" | −90% cost, time to first token 11.5 s → 2.4 s[^15] |
| Batch discount (OpenAI, Anthropic) | 50%[^5][^1] |
| RouteLLM cost cut at 95% of GPT-4 quality (MT Bench) | Over 85%[^3] |
| DistilBERT vs BERT | 40% smaller, 60% faster, 97% of performance[^7] |
| LLM.int8() memory | About half of 16-bit[^8] |
| vLLM throughput gain | 2–4×[^9] |
| Spot discount / warning | Up to 90% / 2 minutes[^11][^12] |

## Failure modes

- **Silent cache misses.** A timestamp or user ID near the top of the system prompt changes the prefix, so every request pays the write premium and never reads. Check `cache_read_input_tokens`; if it and `cache_creation_input_tokens` are both 0, nothing was cached.[^4]
- **Router drift.** A router tuned on last quarter's traffic sends new, harder queries to the small model. Keep a quality evaluation on routed traffic, not only on the large model.
- **Runaway spend.** Agent loops, retries and unbounded `max_tokens` multiply output tokens, the expensive kind. Cap tokens per request and set organization spend limits; Anthropic's API rejects requests with a 400 once a spend limit you set is reached.[^16]
- **Spot evictions without checkpoints.** A two-minute warning is useless if the last checkpoint is six hours old.[^12] Checkpoint on a schedule and on the interruption notice.
- **Idle GPUs.** Reserved or always-on GPU endpoints billed by uptime cost the same at 5% utilization as at 90%.[^2] Right-size replicas and autoscale.
- **Optimizing the wrong unit.** Cutting cost per token while answers get worse raises cost per resolved task. Measure both.

## In the real world

- **Notion** adopted prompt caching for Claude-powered Notion AI features to cut cost and latency.[^15]
- **LMSYS RouteLLM** is an open-source router framework with published cost/quality curves.[^3]
- **vLLM** is the serving system the PagedAttention paper introduced; its memory manager is what lets one GPU batch more requests.[^9]
- **Amazon Bedrock** offers intelligent prompt routing within a model family and global cross-Region inference at a discount.[^2][^13]
- **Hugging Face's DistilBERT** applied distillation during pre-training, the standard reference for shrinking a transformer.[^7]

## In a design interview

Start with **unit economics**: "At 1M requests/day, 3k input and 400 output tokens each, on a $2/$10 per MTok model, that is $6,000 + $4,000 = $10,000/day." Then walk the levers:

1. **Cache:** "The 2k-token system prompt and tool schema are identical across calls; caching cuts most of the input bill."
2. **Route:** "A classifier sends FAQ-style questions to a small model; the large model gets the rest. Quality is gated by an offline eval."
3. **Batch:** "Nightly summarization goes through the Batch API at half price."
4. **Self-host or not:** "Only if steady volume keeps GPUs busy; otherwise the API is cheaper."

Interviewers probe: *How do you know quality didn't drop?* (Eval on routed traffic, cost per resolved task.) *What if the cache hit rate is low?* (Prompt layout, TTL choice.) *Spot for serving?* (Only with on-demand fallback capacity.) *Who owns the budget?* (FinOps: per-team allocation and alerts.)

## 🧱 Builds on

- [[Caching (Deep Dive)]] — prompt caching is prefix caching with TTLs and a write premium; semantic caches reuse cache-aside and its staleness trade-offs.
- [[Estimation (Deep Dive)]] — tokens per request × requests per day × price per token is the back-of-the-envelope that sizes every lever above.
- [[Serverless (Deep Dive)]] — scale-to-zero and pay-per-use remove idle cost, but cold starts and the lack of GPU support limit them to small models.

## Check yourself

> [!question]- Your prompt caching bill shows cache writes on almost every request and few reads. What is wrong?
> The prefix is changing between calls, usually because dynamic content (a timestamp, user data, retrieved chunks) sits before the stable part, or requests arrive less often than the TTL. Move volatile content to the end and consider the 1-hour TTL.

> [!question]- When is self-hosting an open model cheaper than a managed API?
> When volume is high and steady enough to keep GPUs well utilized, since GPU cost accrues by the hour. At low or spiky volume, idle hours dominate and per-token pricing wins.

> [!question]- Why can a router that saves 60% on tokens still raise total cost?
> If it routes hard requests to the weak model, users retry, escalate to humans or abandon tasks. Cost per successful outcome rises even as cost per token falls.

## Further reading

- 📝 [RouteLLM: An Open-Source Framework for Cost-Effective LLM Routing](https://lmsys.org/blog/2024-07-01-routellm/) — clear cost/quality curves for learned routers.
- 📄 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — exact pricing multipliers, TTLs and minimum lengths.
- 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — why GPU memory, not compute, often caps serving cost.
- 📄 [GENCOST01-BP01 Right-size model selection](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gencost01-bp01.html) — AWS's checklist for cost-aware model choice.
- 📄 [Spot Instance interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html) — how to catch the two-minute warning.

## Related

- [[LLM Inference & Optimization (Deep Dive)]] — batching, KV cache and quantization in the serving stack.
- [[Model Selection & Training (Deep Dive)]] — picking and distilling the right-sized model.
- [[Cloud & Infrastructure (Deep Dive)]] — GPU instance types, reservations and capacity planning.
- [[AI Monitoring & Observability (Deep Dive)]] — per-feature cost and token telemetry.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — cheap capacity and fallbacks have to work together.

> [!nav] Keep going
> ← [[AI Security & Privacy (Deep Dive)|AI Security & Privacy]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[AI Reliability & Fault Tolerance (Deep Dive)|AI Reliability & Fault Tolerance]] →
> 🌱 Back to the basics: [[Cost Optimization]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — Anthropic, Claude Platform docs. Official docs. Checked 2026-11.
[^2]: 📄 [GENCOST01-BP01 Right-size model selection to optimize inference costs](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gencost01-bp01.html) — AWS Well-Architected Generative AI Lens. Official docs. Checked 2026-11.
[^3]: 📝 [RouteLLM: An Open-Source Framework for Cost-Effective LLM Routing](https://lmsys.org/blog/2024-07-01-routellm/) — LMSYS, 2024. Article. Checked 2026-11.
[^4]: 📄 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — Anthropic, Claude Platform docs. Official docs. Checked 2026-11.
[^5]: 📄 [Batch API](https://developers.openai.com/api/docs/guides/batch) — OpenAI API docs. Official docs. Checked 2026-11.
[^6]: 🔬 [Distilling the Knowledge in a Neural Network](https://arxiv.org/abs/1503.02531) — Hinton, Vinyals and Dean, 2015. Paper. Checked 2026-11.
[^7]: 🔬 [DistilBERT, a distilled version of BERT](https://arxiv.org/abs/1910.01108) — Sanh et al., Hugging Face, 2019. Paper. Checked 2026-11.
[^8]: 🔬 [LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale](https://arxiv.org/abs/2208.07339) — Dettmers et al., 2022. Paper. Checked 2026-11.
[^9]: 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — Kwon et al., SOSP 2023. Paper. Checked 2026-11.
[^10]: 📄 [Deploy models with Amazon SageMaker Serverless Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html) — Amazon SageMaker Developer Guide. Official docs. Checked 2026-11.
[^11]: 📄 [Amazon EC2 Spot Instances](https://aws.amazon.com/ec2/spot/) — Amazon Web Services. Official docs. Checked 2026-11.
[^12]: 📄 [Spot Instance interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html) — Amazon EC2 User Guide. Official docs. Checked 2026-11.
[^13]: 📄 [Route model inference requests across AWS Regions with cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) — Amazon Bedrock User Guide. Official docs. Checked 2026-11.
[^14]: 📄 [What is FinOps?](https://learn.microsoft.com/en-us/cloud-computing/finops/overview) — Microsoft Learn. Official docs. Checked 2026-11.
[^15]: 📝 [Prompt caching with Claude](https://claude.com/blog/prompt-caching) — Anthropic. Engineering blog. Checked 2026-11.
[^16]: 📄 [Claude API errors](https://platform.claude.com/docs/en/api/errors) — Anthropic, Claude Platform docs. Official docs. Checked 2026-11.
