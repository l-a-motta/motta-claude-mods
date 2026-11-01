---
aliases: [AI Scalability & Distributed Systems deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[AI Scalability & Distributed Systems]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[AI Scalability & Distributed Systems]] › 🔬 Deep Dive

> [!tldr] For engineers
> Large-model training is a memory and communication problem. Data parallelism replicates the model and all-reduces gradients; sharded data parallelism (ZeRO, FSDP) partitions parameters, gradients and optimizer state; tensor and pipeline parallelism split the model itself. Frontier runs stack all of them on clusters of tens of thousands of GPUs, where the network and constant hardware failures set the real limits. Serving scales more simply, with replicas and metric-driven autoscaling.

> [!basics]- New to this? Start with the basics
> [[AI Scalability & Distributed Systems]] explains it with no jargon.

## How it really works

### Data parallelism and all-reduce

In PyTorch's `DistributedDataParallel` (DDP), each process holds a full replica. At construction, DDP broadcasts the model state from rank 0 so replicas start identical. During backward, autograd hooks mark gradients ready; gradients are grouped into **buckets**, and when a bucket fills, an asynchronous **all-reduce** averages it across processes while backward keeps computing the rest.[^1] That overlap of communication with computation is where DDP gets its speed.[^1]

```python
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP

dist.init_process_group("nccl")          # one process per GPU
model = DDP(MyModel().cuda(local_rank), device_ids=[local_rank])
for batch in loader:                     # each rank reads a different shard
    loss = model(batch).loss
    loss.backward()                      # gradients all-reduced in buckets
    optimizer.step()                     # every replica applies the same update
```

All-reduce combines a buffer across ranks (for example by sum) and leaves the result on every rank. NVIDIA's NCCL notes it is equivalent to a **reduce-scatter** followed by an **all-gather**.[^2]

### Sharded data parallelism: ZeRO and FSDP

Plain DDP requires the whole model to fit on one GPU.[^3] Yet most of the memory is redundant: every rank stores identical parameters, gradients and optimizer states. **ZeRO** removes that redundancy while keeping communication volume low; the authors trained 100B+ parameter models on 400 GPUs with super-linear speedup and up to 13B parameters without any model parallelism.[^4] ZeRO comes in three stages: stage 1 partitions optimizer states, stage 2 adds gradients, stage 3 adds the parameters themselves.[^5]

PyTorch **FSDP** implements full sharding natively. Layers are wrapped so only one unit's full parameters are gathered at a time for forward or backward, then freed; parameters, gradients and optimizer state can also be offloaded to CPU.[^3] On AWS, FSDP trained GPT-style models at 175B and 1T parameters, reaching 159 TFLOP/s per A100 (51% of peak) for 175B on 128 GPUs; adding more GPUs degraded per-GPU throughput as inter-node communication grew.[^3]

### Tensor parallelism

**Tensor parallelism** slices individual weight matrices so several GPUs compute one layer together, synchronizing the partial results.[^5] Megatron-LM's intra-layer approach needed only a few communication operations in native PyTorch and trained an 8.3B-parameter model on 512 GPUs at 15.1 PFLOP/s, 76% scaling efficiency against a single-GPU baseline.[^6] Because it communicates inside every layer, it is usually kept within a node on the fastest links.

### Pipeline parallelism

**Pipeline parallelism** assigns consecutive groups of layers to different devices. GPipe splits each mini-batch into micro-batches so stages work concurrently, reporting almost linear speedup and a single 6B-parameter, 128-layer Transformer.[^7] Idle time cannot be removed completely: the last forward pass still waits for backward to finish, the so-called **pipeline bubble**.[^5]

### Putting it together: 4D parallelism

Meta trained Llama 3 405B on up to **16K H100 GPUs** with four dimensions: tensor, context (splitting the sequence), pipeline and data parallelism, where the data dimension is FSDP. Ranks are grouped in the order [TP, CP, PP, DP], with DP outermost.[^8] The result was 38 to 43% BF16 **model FLOPs utilization** (MFU), the share of the hardware's peak math actually used for the model.[^8]

The cluster matters as much as the algorithm. Meta's two training clusters each have 24,576 H100s, one on RoCE Ethernet and one on InfiniBand, both with 400 Gbps endpoints.[^9] Untuned, the large clusters ran at about 10 to 90% utilization against 90%+ on small clusters; topology-aware scheduling, routing changes and NCCL tuning brought them back above 90%.[^9]

### Scaling the serving side

Serving scales out with replicas behind a load balancer and an autoscaler. Kubernetes' Horizontal Pod Autoscaler runs every 15 seconds by default and computes:[^10]

```text
desiredReplicas = ceil( currentReplicas * currentMetricValue / desiredMetricValue )
```

It can target CPU utilization or custom and external metrics, such as requests in flight or queue depth.[^10] Defaults scale up immediately (up to 100% or 4 pods per 15 s, whichever is more) but wait a 300-second stabilization window before scaling down, to avoid flapping.[^10]

## Design choices and trade-offs

| Strategy | What is split | Memory per GPU | Communication | Use when |
| --- | --- | --- | --- | --- |
| DDP | Data only | Full model, grads, optimizer | All-reduce of gradients per step[^1] | Model fits on one GPU[^5] |
| ZeRO / FSDP | Data plus sharded state | Fraction of model state | All-gather each unit's params before use[^3] | Model doesn't fit on one GPU[^5] |
| Tensor parallel | Each layer's matrices | Fraction of each layer | Every layer, high bandwidth | Largest layer doesn't fit on one GPU[^5] |
| Pipeline parallel | Groups of layers | Fraction of layers | Activations between stages only | Model doesn't fit on one GPU[^5] |
| Hybrid (3D/4D) | All of the above | Lowest | Mixed, mapped to topology | Frontier-scale models[^8] |
| Serving replicas + autoscaler | Requests | Full model per replica | None between replicas | Model fits on one node; traffic varies[^10] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Llama 3 405B training scale | Up to 16K H100 GPUs, 4D parallelism[^8] |
| Llama 3 model FLOPs utilization | 38 to 43% (BF16)[^8] |
| Llama 3 interruptions in 54 days | 466 total, 419 unexpected; about 78% hardware-related[^8] |
| Llama 3 effective training time | Over 90%[^8] |
| Meta GenAI cluster size | 24,576 H100s each, 400 Gbps endpoints[^9] |
| Meta checkpoint time after tuning | Hundreds of milliseconds[^9] |
| Megatron-LM | 8.3B params, 512 GPUs, 76% scaling efficiency[^6] |
| ZeRO | 100B+ params on 400 GPUs; 8x larger models than prior art[^4] |
| FSDP, GPT 175B on 128 A100s | 159 TFLOP/s per GPU, 51% of peak[^3] |
| HPA defaults | 15 s sync; 300 s scale-down stabilization[^10] |

## Failure modes

- **Hardware failure is routine.** In Llama 3's 54-day snapshot, there were 419 unexpected interruptions, about eight a day, and GPU issues were the largest category (58.7%); automated maintenance added at least one more a day.[^8] Checkpoint frequently and restart automatically.
- **One bad GPU stalls everything.** Synchronous collectives wait for the slowest rank, and finding a single faulty GPU at scale is very hard; Meta built tooling such as a distributed collective flight recorder to track it down.[^9]
- **Hangs from mismatched collectives.** If ranks issue all-reduces in different orders, DDP can produce wrong results or hang, so it always reduces buckets in index order; parameters unused in forward also stall backward unless `find_unused_parameters` is set.[^1]
- **Communication-bound scaling.** Past a point, adding GPUs lowers per-GPU throughput.[^3] Keep tensor parallelism on fast links and tune the network.[^9]
- **Memory ceilings.** In FSDP's 1T run, the bottleneck was the CUDA caching allocator near peak memory, not the network.[^3]
- **Pipeline bubbles.** Too few micro-batches leave stages idle.[^5]
- **Autoscaler flapping.** Noisy metrics cause rapid scale up and down; the scale-down stabilization window damps it.[^10]

## In the real world

- **Meta** trained Llama 3 on its 24K-GPU clusters with 4D parallelism and a NCCL fork called NCCLX.[^8][^9]
- **ZeRO** was used to build Turing-NLG, a 17B-parameter language model.[^4]
- **Megatron-LM** (Shoeybi et al.) showed intra-layer tensor parallelism at 512-GPU scale.[^6]
- **GPipe** (Huang et al.) introduced batch-splitting pipeline parallelism with almost linear speedup.[^7]
- **PyTorch** upstreamed FSDP from FairScale in version 1.11.[^3]

## In a design interview

Show you can size the problem before naming a technique.

1. **Memory first.** "Weights, gradients and optimizer state per parameter, plus activations. If it fits on one GPU, start with DDP."
2. **Doesn't fit?** "FSDP or ZeRO-3 first, since it keeps the data-parallel programming model. Add tensor parallelism inside a node if one layer is too big, and pipeline across nodes if needed."
3. **Network.** "Map the chattiest dimension to the fastest links."
4. **Failures.** "Thousands of GPUs means daily failures: frequent async checkpoints, automatic restart, health checks to evict bad nodes."
5. **Serving.** "Replicas behind a load balancer, autoscaled on requests in flight or GPU queue depth, with warm spare capacity."

Probes: *Why not just add GPUs?* (Communication overhead and stragglers.) *What does FSDP trade?* (Memory for extra gather traffic.) *How do you know you're efficient?* (Track MFU.)

## 🧱 Builds on

- [[Sharding (Deep Dive)]] — ZeRO and FSDP partition model state across ranks, the same idea as partitioning a dataset across shards.[^4]
- [[Replication (Deep Dive)]] — DDP keeps replicas consistent with a synchronous all-reduce every step, like synchronous replication of state.[^1]
- [[Load Balancing (Deep Dive)]] — serving replicas sit behind a load balancer, with an autoscaler resizing the pool.[^10]
- [[Concurrency (Deep Dive)]] — DDP overlaps gradient communication with backward computation, and collectives must be issued in a consistent order to avoid deadlock-like hangs.[^1]

## Check yourself

> [!question]- Your 7B model trains fine with DDP on 8 GPUs, but the 70B version runs out of memory. What is the least invasive change?
> Move to FSDP or ZeRO-3. It shards parameters, gradients and optimizer state across the same ranks while keeping the data-parallel model, so no layer surgery is needed.

> [!question]- Why is tensor parallelism usually kept inside a node while pipeline parallelism can span nodes?
> Tensor parallelism communicates inside every layer, so it needs the highest-bandwidth links. Pipeline stages exchange only activations at boundaries, which tolerates slower links.

> [!question]- Your training job's throughput drops to near zero for minutes at a time, then recovers. What do you suspect?
> A straggler or failing GPU: synchronous collectives make every rank wait for the slowest one. Check per-rank timings and hardware health, then evict the bad node.

## Further reading

- 📄 [Parallelism methods](https://huggingface.co/docs/transformers/perf_train_gpu_many) — a clear map of strategies with a when-to-use table.
- 📄 [Distributed Data Parallel](https://docs.pytorch.org/docs/2.15/notes/ddp.html) — how DDP buckets and overlaps all-reduce, from the source.
- 🔬 [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054) — the paper behind sharded data parallelism.
- 🔬 [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783v3) — section 3.3 is a rare look at frontier-scale training infrastructure and failures.
- 📝 [Building Meta's GenAI Infrastructure](https://engineering.fb.com/2024/03/12/data-center-engineering/building-metas-genai-infrastructure/) — what it takes to make 24K-GPU clusters perform.

## Related

- [[Cloud & Infrastructure (Deep Dive)]] — GPUs, networks and storage underneath.
- [[Deployment & Serving (Deep Dive)]] — batching and rollout for the serving side.
- [[LLM Inference & Optimization (Deep Dive)]] — tensor parallelism and KV caches at inference time.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — checkpointing and recovery.
- [[Cost Optimization (Deep Dive)]] — utilization is money.

> [!nav] Keep going
> ← [[Deployment & Serving (Deep Dive)|Deployment & Serving]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[AI Monitoring & Observability (Deep Dive)|AI Monitoring & Observability]] →
> 🌱 Back to the basics: [[AI Scalability & Distributed Systems]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Distributed Data Parallel](https://docs.pytorch.org/docs/2.15/notes/ddp.html) — PyTorch documentation (2.15). Official docs. Checked 2026-11.
[^2]: 📄 [Collective Operations](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html) — NVIDIA NCCL documentation. Official docs. Checked 2026-11.
[^3]: 📝 [Introducing PyTorch Fully Sharded Data Parallel (FSDP) API](https://pytorch.org/blog/introducing-pytorch-fully-sharded-data-parallel-api/) — PyTorch Blog. Engineering blog. Checked 2026-11.
[^4]: 🔬 [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054) — Rajbhandari et al., arXiv 1910.02054, 2019. Paper. Checked 2026-11.
[^5]: 📄 [Parallelism methods](https://huggingface.co/docs/transformers/perf_train_gpu_many) — Hugging Face Transformers documentation. Official docs. Checked 2026-11.
[^6]: 🔬 [Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism](https://arxiv.org/abs/1909.08053) — Shoeybi et al., arXiv 1909.08053, 2019. Paper. Checked 2026-11.
[^7]: 🔬 [GPipe: Efficient Training of Giant Neural Networks using Pipeline Parallelism](https://arxiv.org/abs/1811.06965) — Huang et al., arXiv 1811.06965, 2018. Paper. Checked 2026-11.
[^8]: 🔬 [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783v3) — Grattafiori et al., arXiv 2407.21783, 2024, section 3.3. Paper. Checked 2026-11.
[^9]: 📝 [Building Meta's GenAI Infrastructure](https://engineering.fb.com/2024/03/12/data-center-engineering/building-metas-genai-infrastructure/) — Lee, Gangidi and Oldham, Engineering at Meta, 2024. Engineering blog. Checked 2026-11.
[^10]: 📄 [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) — Kubernetes documentation. Official docs. Checked 2026-11.
