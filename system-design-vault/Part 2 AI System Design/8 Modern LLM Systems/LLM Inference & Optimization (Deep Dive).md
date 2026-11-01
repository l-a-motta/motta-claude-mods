---
aliases: [LLM Inference & Optimization deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[LLM Inference & Optimization]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[LLM Inference & Optimization]] › 🔬 Deep Dive

> [!tldr] For engineers
> Autoregressive decoding is **memory-bandwidth bound**: every output token re-reads the weights and the growing **KV cache**, so throughput is set by how many sequences fit in GPU memory and how well you batch them. The production stack is continuous (iteration-level) batching, paged KV memory with prefix reuse, quantized weights and KV, and speculative decoding for latency. Measure TTFT and TPOT separately, because the knobs that raise throughput usually hurt per-user latency.

> [!basics]- New to this? Start with the basics
> [[LLM Inference & Optimization]] explains it with no jargon.

## How it really works

### Two phases with different bottlenecks

A request runs in two phases. **Prefill** processes all prompt tokens in parallel: a matrix-matrix operation that saturates the GPU. **Decode** emits one token per forward pass: a matrix-vector operation in which moving weights, keys, values and activations from memory dominates latency.[^1] That is why achieved memory bandwidth predicts token speed better than peak FLOPS.[^2]

User-facing latency splits the same way:[^2]

```text
latency = TTFT + TPOT × output_tokens
TTFT  = time to first token  (queueing + prefill)
TPOT  = time per output token (one decode step)
```

**Model Bandwidth Utilization (MBU)** = achieved bandwidth / peak bandwidth, where achieved bandwidth = (weight bytes + KV bytes) / TPOT. A 7B model in 16-bit moves 14 GB per step; at 14 ms TPOT that is 1 TB/s, or 50% MBU on a 2 TB/s machine.[^2]

### The KV cache

Attention needs the key and value vectors of every previous token. Caching them turns each decode step from O(n) recomputation into one new row. The cost is memory:[^1]

```python
def kv_cache_bytes(batch, seq_len, layers, hidden, bytes_per_value=2):
    # 2 = one key + one value tensor per layer
    return batch * seq_len * 2 * layers * hidden * bytes_per_value

kv_cache_bytes(1, 4096, 32, 4096)   # Llama 2 7B, FP16: ~2.15e9 bytes (~2 GB)
```

The weights of the same model take about 14 GB in FP16,[^1] so a handful of long sequences already rivals the model itself. Multi-query and grouped-query attention share keys and values across heads to shrink this footprint.[^1]

### Batching: static vs. continuous

Batching amortizes each weight read across many sequences. **Static batching** holds the batch until its longest sequence finishes, idling the GPU on short ones.[^3] **Continuous batching** (iteration-level scheduling, introduced by the Orca paper) re-forms the batch every decode step: finished sequences leave, queued ones join.[^3] Because prefill does not batch cleanly with decode, schedulers expose knobs to balance the two.[^3]

### Paged KV memory

Pre-allocating a contiguous KV region per request at maximum length fragments memory. Existing systems wasted **60–80%** of KV memory this way.[^4] **PagedAttention** splits each sequence's cache into fixed-size blocks mapped through a block table, like virtual memory pages, so waste is confined to the last block (under 4%) and blocks can be shared across parallel samples or beams.[^4][^5] The vLLM paper reports 2–4× throughput over FasterTransformer and Orca at equal latency.[^5]

### Prefix caching

When requests share a prefix (system prompt, few-shot examples, chat history), vLLM's **automatic prefix caching** hashes each full KV block from its parent's hash plus its tokens, looks matching blocks up for new requests, and skips their prefill. Free blocks are evicted LRU; outputs are unchanged.[^6]

### Shrinking the model: quantization

Quantization stores weights (and optionally activations and KV) in fewer bits: FP16/BF16 down to INT8, INT4 or lower.[^7] Halving bytes per weight halves both the memory and the bytes moved per decode step. **LLM.int8()** showed a 175B model running in 8-bit with no measured degradation by keeping rare outlier features in 16-bit (over 99.9% of values multiply in 8-bit).[^8] One catch: with weight-only quantization, GPUs lack INT8×FP16 hardware, so weights are dequantized on the fly.[^1]

### Cutting decode steps: speculative decoding

A cheap **draft** model proposes k tokens; the target model verifies all k in parallel and keeps them up to the first rejected one.[^1] With the paper's rejection-sampling rule the output distribution is **identical** to the target model's, with no retraining; it measured 2–3× speedups on T5-XXL.[^9]

### Kernel and parallelism

**FlashAttention** computes exact attention with tiling so fewer reads and writes hit GPU high-bandwidth memory (HBM), with about 3× speedup on GPT-2 training.[^10] Models too large for one GPU are split with **tensor parallelism** (each layer across GPUs) or **pipeline parallelism** (layers across GPUs, with "bubbles" that microbatching only reduces).[^1]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Larger max batch | Higher tokens/s per GPU | Higher TPOT and TTFT; more KV memory |
| Continuous batching | No idle slots; better p50 latency | Scheduler complexity; prefill/decode interference |
| Paged KV + prefix caching | Near-zero waste; reuse of shared prompts | Block-table indirection; cache must be prefix-stable |
| INT8 / INT4 weights | Fewer GPUs; faster decode | Possible quality loss; needs evaluation |
| Speculative decoding | Lower latency at low batch sizes | Extra draft model; gains fall when acceptance is low or GPU is already saturated |
| Tensor parallelism | Fits big models; lower latency | Communication overhead; diminishing returns |
| Bigger GPU (more bandwidth) | Lower TPOT directly | Cost per hour |

The core tension: **throughput vs. latency**. A batch-1 server minimizes TPOT and wastes the GPU; a batch-64 server is efficient but every user waits longer.

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| KV cache, Llama 2 7B, FP16, 4,096 tokens, batch 1 | ~2 GB[^1] |
| Weights, 7B model, FP16 | ~14 GB[^1] |
| KV memory wasted by pre-PagedAttention systems | 60–80%; vLLM under 4%[^4] |
| vLLM throughput vs. HF Transformers / TGI (2023) | Up to 24× / 3.5×[^4] |
| Continuous batching vs. naive static batching | 8× alone; up to 23× with vLLM memory management[^3] |
| Batch size raised to 64 on one A100 | 14× throughput, 4× latency[^2] |
| MBU at batch 1 | 60% on 2×H100, 55% on 4×A100-40GB[^2] |
| TTFT, 512-token prompt, batch 1, 1→4 A100s | 46 ms → 26 ms[^2] |
| Llama-2-70B KV, batch 64, seq 1,024: FP16 → INT8 | 20 GiB → 10 GiB[^2] |
| Speculative decoding on T5-XXL | 2–3×, identical outputs[^9] |
| H100-80GB vs. A100-40GB memory bandwidth | 2.15×[^2] |

Rule of thumb: decode tokens/s per sequence ≈ achievable bandwidth ÷ bytes read per step. If your estimate and reality differ by 2×, look at MBU first.

## Failure modes

- **KV cache exhaustion.** Long contexts or a traffic burst fill memory and the scheduler must preempt or reject sequences. Defend with paged KV, admission control on prompt length, and KV quantization.[^2][^4]
- **Latency collapse under load.** As QPS rises, continuous batchers with small maximum batch sizes saturate and latency climbs; in Anyscale's test vLLM held latency at QPS 4 where others slowed.[^3] Load-test at realistic arrival rates, not bursts.
- **Prefill interference.** Prefill does not batch cleanly with decode, so a huge prompt entering the batch can stall generation for others. Schedulers expose knobs such as `waiting_served_ratio` to balance the two.[^3]
- **Silent quality regressions.** Naive quantization can substantially degrade output quality; run your eval set before and after.[^2]
- **Speculation that does not pay.** A poorly matched draft model gets rejected often, adding work.
- **Prefix cache misses.** Anything volatile early in the prompt (timestamps, user IDs) breaks block hashes.[^6] Shared caches can also leak timing information across tenants; vLLM's `cache_salt` scopes sharing.[^6]
- **Over-parallelizing.** Going from 4 to 8 GPUs on Llama2-70B cut latency only to 0.7× at small batch sizes.[^2]

## In the real world

- **LMSYS** moved Vicuna and Chatbot Arena from a Hugging Face backend to vLLM, serving up to 5× more traffic with 50% fewer GPUs.[^4]
- **vLLM** popularized PagedAttention and prefix caching; the paper appeared at SOSP 2023.[^5][^6]
- **Anyscale** benchmarked Ray Serve, Hugging Face text-generation-inference, FasterTransformer and vLLM on OPT-13B.[^3]
- **NVIDIA** calls its continuous batching "in-flight batching".[^1]
- **Databricks/MosaicML** publish MBU and TTFT tables for MPT and Llama 2 on A100 and H100.[^2]

## In a design interview

Start from the workload, then size, then optimize:

1. **Requirements.** "Chat assistant, p50 TTFT under 500 ms, 30 tokens/s per user, 2k-token prompts, 300-token answers."
2. **Memory math.** Weights + KV per sequence × concurrent sequences ≤ GPU memory → max batch per GPU → GPUs needed.
3. **Serving stack.** vLLM-style engine: continuous batching, paged KV, prefix caching for the shared system prompt.
4. **Levers.** INT8 weights to halve GPUs if evals pass; speculative decoding if latency-bound at low load.
5. **Fleet.** Replicas behind a load balancer with queue-depth-aware routing; autoscale on queue length and KV utilization.

Interviewers probe: *Why is decode memory-bound?* *What happens when a 100k-token prompt arrives?* *How do you trade throughput for latency?* *How do you know quantization did not hurt quality?*

## 🧱 Builds on

- [[Caching]] — the KV cache is memoization of attention state; prefix caching is a content-addressed block cache with LRU eviction and hit rates to tune.
- [[Concurrency]] — continuous batching is an iteration-level scheduler multiplexing many sequences on one device, with preemption under memory pressure.
- [[Load Balancing]] — replicas need routing that respects queue depth and, ideally, prefix locality so cached blocks get reused.
- [[Estimation]] — KV bytes, weight bytes and bandwidth ÷ bytes-per-step give back-of-envelope capacity and TPOT before any benchmark.

## Check yourself

> [!question]- Doubling batch size doubled throughput at first, then stopped helping while latency kept rising. Why?
> At small batches decode is memory-bound, so extra sequences ride on the same weight reads almost for free. Past a point the workload becomes compute-bound, and each extra sequence adds latency without adding throughput.

> [!question]- Why does PagedAttention allow larger batches without more GPUs?
> It replaces per-request contiguous reservations with small on-demand blocks, cutting KV waste from 60–80% to under 4%. The reclaimed memory holds more concurrent sequences.

> [!question]- When would you skip speculative decoding?
> When the server is already compute-saturated at large batch sizes, or when the draft model's acceptance rate is low. Then verification work outweighs the saved decode steps.

## Further reading

- 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — the vLLM paper; the clearest account of KV memory management.
- 📝 [LLM Inference Performance Engineering: Best Practices](https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices) — TTFT, TPOT and MBU with real hardware tables.
- 📝 [How continuous batching enables 23x throughput](https://www.anyscale.com/blog/continuous-batching-llm-inference) — static vs. continuous batching, explained with benchmarks.
- 📝 [Mastering LLM Techniques: Inference Optimization](https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/) — one-page tour of every major optimization.
- 🔬 [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192) — the original speculative decoding paper.

## Related

- [[Deployment & Serving (Deep Dive)]] — where inference engines sit in the serving stack.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — tensor and pipeline parallelism at fleet scale.
- [[Cost Optimization (Deep Dive)]] — turning tokens/s per GPU into dollars.
- [[Context Engineering (Deep Dive)]] — prompt structure that makes prefix caching work.
- [[Caching (Deep Dive)]] — eviction and hit-ratio thinking applied to KV blocks.

> [!nav] Keep going
> ← [[Retrieval-Augmented Generation (Deep Dive)|Retrieval-Augmented Generation]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[AI Agents & Tool Use (Deep Dive)|AI Agents & Tool Use]] →
> 🌱 Back to the basics: [[LLM Inference & Optimization]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Mastering LLM Techniques: Inference Optimization](https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/) — NVIDIA Technical Blog, 2023. Engineering blog. Checked 2026-11.
[^2]: 📝 [LLM Inference Performance Engineering: Best Practices](https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices) — Databricks (MosaicML), 2023. Engineering blog. Checked 2026-11.
[^3]: 📝 [How continuous batching enables 23x throughput in LLM inference while reducing p50 latency](https://www.anyscale.com/blog/continuous-batching-llm-inference) — Anyscale, 2023. Engineering blog. Checked 2026-11.
[^4]: 📝 [vLLM: Easy, Fast, and Cheap LLM Serving with PagedAttention](https://vllm.ai/blog/2023-06-20-vllm) — vLLM team, UC Berkeley, 2023. Engineering blog. Checked 2026-11.
[^5]: 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — Kwon et al., SOSP 2023. Paper. Checked 2026-11.
[^6]: 📄 [Automatic Prefix Caching](https://docs.vllm.ai/en/latest/design/prefix_caching.html) — vLLM documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Quantization overview](https://huggingface.co/docs/transformers/main/en/quantization/overview) — Hugging Face Transformers documentation. Official docs. Checked 2026-11.
[^8]: 🔬 [LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale](https://arxiv.org/abs/2208.07339) — Dettmers et al., NeurIPS 2022. Paper. Checked 2026-11.
[^9]: 🔬 [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192) — Leviathan, Kalman and Matias, ICML 2023. Paper. Checked 2026-11.
[^10]: 🔬 [FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness](https://arxiv.org/abs/2205.14135) — Dao et al., 2022. Paper. Checked 2026-11.
