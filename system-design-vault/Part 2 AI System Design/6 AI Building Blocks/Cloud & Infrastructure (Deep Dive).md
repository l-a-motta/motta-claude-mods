---
aliases: ["Cloud & Infrastructure deep dive"]
tags: [level/deep-dive, part/2, section/ai-building-blocks]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Building Blocks]]"
basics: "[[Cloud & Infrastructure]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Building Blocks]] › [[Cloud & Infrastructure]] › 🔬 Deep Dive

> [!tldr] For engineers
> AI infrastructure is a balance of **accelerator FLOPS, memory capacity and bandwidth, interconnect, and storage throughput**; the slowest of the four sets your speed. Training wants large, tightly networked clusters for weeks and must survive constant hardware failures; serving wants many smaller, cost-efficient replicas close to users. The cloud lets you buy each shape separately, at on-demand, interruptible or serverless prices.

> [!basics]- New to this? Start with the basics
> [[Cloud & Infrastructure]] explains it with no jargon.

## How it really works

### Accelerators

A CPU has a few cores tuned for low latency on serial work; a GPU has many cores tuned for throughput on parallel work, and NVIDIA's add **Tensor Cores** for the matrix multiplications at the heart of deep learning.[^1] A well-documented reference point is the NVIDIA H100 SXM, the GPU inside the Azure, AWS and Meta systems described below: 80 GB of HBM3 at 3.35 TB/s, 1,979 FP16 Tensor teraFLOPS (with sparsity), 900 GB/s NVLink to neighboring GPUs, up to 700 W, and up to seven isolated Multi-Instance GPU slices.[^2] It is no longer NVIDIA's newest part: the same page now points to Blackwell-generation systems, and NVIDIA claims its B200 serves inference about 4.5× cheaper per token than the H100.[^2] The numbers change by generation; the budget below does not.

Read those numbers as a budget. **Memory capacity** decides whether the model's weights and activations fit on one chip. **Memory bandwidth** decides how fast those weights can stream into the cores. **FLOPS** only matter once the first two keep the cores fed.

Google's **TPU** is an ASIC for ML. Its core is the **MXU**, a 128×128 systolic array that pumps operands through a grid of multiply-accumulate cells; programs are compiled by XLA, and chips are linked into **slices** that scale with little code change.[^3] TPUs fit matrix-dominated models with large batches and huge embeddings, and fit poorly on branch-heavy code, high-precision math or custom ops inside the training loop.[^3] The first-generation TPU had 65,536 8-bit multiply-accumulate units for 92 TOPS, and its deterministic execution suited 99th-percentile latency targets better than CPUs and GPUs.[^4]

### Scale-up and scale-out networking

One model rarely fits on one chip, so infrastructure is designed in two tiers:

- **Scale-up, inside a node.** Eight GPUs share a fast fabric. Azure's ND H100 v5 links its eight H100s with NVLink 4.0.[^5]
- **Scale-out, between nodes.** Each GPU gets its own NIC. Azure gives each GPU a dedicated 400 Gbps InfiniBand link, 3.2 Tbps per VM, with GPUDirect RDMA support and NVIDIA's NCCL library for collective communication across GPUs.[^5] AWS P5 offers up to 3,200 Gbps of EFA networking and UltraClusters of up to 20,000 GPUs.[^6]

Meta built two 24,576-GPU H100 clusters to compare fabrics head to head: one on RoCE (RDMA over Ethernet) with Arista switches, one on NVIDIA Quantum-2 InfiniBand, both with 400 Gbps endpoints.[^7] Even GPT-3 in 2020 had to be split across GPUs, with model parallelism both within each matrix multiply and across layers, on a high-bandwidth Microsoft cluster.[^8]

### Feeding the chips: storage

Object storage is the durable, cheap home for datasets and checkpoints, but training reads need a faster layer in front. Amazon FSx for Lustre can link to an S3 bucket and present its objects as files, with sub-millisecond latency and up to multiple TB/s of throughput; with SageMaker it removes the initial download from S3.[^9] Meta exposes a FUSE file API over a flash-optimized build of its Tectonic distributed storage, plus a Hammerspace NFS deployment for interactive debugging.[^7]

### The operating system and orchestration layer

A GPU is useless until the OS and scheduler know about it. In Kubernetes, nodes need the vendor's drivers and device plugin, which expose a resource such as `nvidia.com/gpu`; containers request GPUs only under `limits`, and node labels steer pods to the right GPU model.[^10]

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: trainer
spec:
  nodeSelector:
    accelerator: h100          # label set by the cluster admin or NFD
  containers:
    - name: train
      image: registry.example/trainer:1.4
      resources:
        limits:
          nvidia.com/gpu: 8    # whole GPUs, limits only
```

### How you pay for it

NIST defines cloud computing as on-demand network access to a shared pool of configurable resources that can be provisioned and released with minimal effort.[^11] For AI that becomes four buying modes:

- **On-demand** instances: fixed hourly price, but launch can fail with an insufficient-capacity error.[^12]
- **Spot** instances: spare capacity below the on-demand price, reclaimed with a two-minute warning, plus an earlier rebalance signal.[^12]
- **Serverless inference**: scales to zero and bills per use; on SageMaker it offers 1–6 GB of memory, no GPUs, and cold starts unless you pay for provisioned concurrency.[^13]
- **Owned (on-premise)** hardware: what Meta does at hyperscale, aiming for 350,000 H100s by the end of 2024.[^7]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| GPU | Broad framework support, flexible for custom ops | Power, price, supply |
| TPU | Strong on large matrix-heavy training and big embeddings | XLA compile model; poor fit for branchy or custom-op code |
| CPU | Cheap, available, fine for small models and I/O-bound jobs | Far slower for large neural networks |
| On-demand cloud | No commitment; fast to start | Highest hourly rate; capacity not guaranteed |
| Spot cloud | Large discount | Two-minute eviction; needs checkpointing |
| Serverless inference | Scale to zero; no servers to manage | Cold starts, memory caps, no GPU (SageMaker) |
| On-premise | Lowest unit cost at steady, high utilization | Capex, lead time, you run the failures |
| InfiniBand fabric | Mature RDMA for collectives | Separate network stack and vendor |
| RoCE fabric | Ethernet tooling and suppliers | Congestion tuning at scale |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| H100 SXM memory and bandwidth | 80 GB HBM3, 3.35 TB/s[^2] |
| H100 SXM NVLink | 900 GB/s[^2] |
| H100 SXM power | Up to 700 W[^2] |
| AWS P5 instance | 8 H100s, 640 GB HBM3, 3,200 Gbps EFA, 30 TB local NVMe[^6] |
| Azure ND H100 v5 | 8 H100s, 400 Gbps InfiniBand per GPU, 3.2 Tbps per VM[^5] |
| TPU v1 vs Haswell CPU and K80 GPU | 15–30× faster, 30–80× better TOPS/W[^4] |
| Meta GenAI clusters (2024) | 2 × 24,576 H100s, 400 Gbps endpoints[^7] |
| Llama 3 405B pre-training | Up to 16K H100s; 466 job interruptions in 54 days; about 78% of unexpected ones from confirmed or suspected hardware issues[^14] |
| Llama 3 effective training time | Above 90%[^14] |
| SageMaker serverless endpoint | 1,024–6,144 MB memory; max concurrency 200 per endpoint[^13] |

## Failure modes

- **Hardware fails constantly at scale.** Llama 3 pre-training saw 419 unexpected interruptions in 54 days, about 78% of them from confirmed or suspected hardware issues, and faulty GPUs alone accounted for 148 interruptions.[^14] Defend with frequent checkpoints, fast restart and automated node health checks.
- **Power and heat.** Thousands of GPUs changing load together can swing data-center power by tens of megawatts, and throughput varied 1–2% with time of day.[^14] Plan power and cooling with the facility team.
- **Starved accelerators.** If storage or the input pipeline can't keep up, expensive GPUs idle. A parallel file layer in front of object storage exists for exactly this.[^9]
- **Capacity shortages.** On-demand launches can fail with insufficient capacity, and spot nodes vanish on two minutes' notice.[^12] Reserve capacity for critical runs; make training preemption-safe.
- **Cold starts.** Serverless endpoints spin up compute after idle periods, adding latency that depends on model size and container start time.[^13]
- **Driver and scheduling drift.** Pods that land on nodes without the right drivers or GPU type fail; use device plugins and node labels.[^10]

## In the real world

- **Meta** builds its own H100 clusters on its Grand Teton platform and compares RoCE with InfiniBand at 24K-GPU scale.[^7]
- **OpenAI GPT-3** trained on V100 GPUs in a Microsoft-provided cluster.[^8]
- **Google** has run TPUs in its data centers since 2015 and rents them on Cloud TPU.[^4][^3]
- **AWS** and **Azure** rent eight-GPU H100 nodes with 3.2 Tbps-class networking.[^6][^5]

## In a design interview

Sketch training and serving as two separate fleets:

1. **Size the work:** "The model is X billion parameters; at 2 bytes each the weights need about 2X GB, so serving needs at least one 80 GB GPU per replica."
2. **Pick the accelerator:** "GPUs for flexibility; TPUs if we're on GCP with matrix-heavy training."
3. **Network:** "Training in one cluster with RDMA (InfiniBand or RoCE) and NVLink inside nodes; serving replicas spread across zones."
4. **Storage:** "Datasets and checkpoints in object storage, a parallel file system in front for training throughput."
5. **Cost and resilience:** "Spot for fine-tuning jobs with checkpoints every N minutes; on-demand or reserved for serving; autoscale on queue depth."

Interviewers probe: *What happens when a GPU dies mid-run?* (Checkpoint and restart; spare nodes.) *Cloud or own hardware?* (Cloud for spiky or early work; own hardware only at sustained high utilization.) *Why is the GPU at 30% utilization?* (Input pipeline, small batches or network-bound collectives.)

## 🧱 Builds on

- [[Serverless (Deep Dive)]] — scale-to-zero billing and cold starts carry over to serverless model endpoints, with tight memory caps.
- [[Operating Systems (Deep Dive)]] — drivers, device plugins and memory management decide which process gets which GPU.
- [[Networking (Deep Dive)]] — RDMA, per-GPU NICs and fabric topology set the speed of distributed training.
- [[Object Storage (Deep Dive)]] — S3-style buckets are the durable layer behind parallel file systems and checkpoints.

## Check yourself

> [!question]- A 70B-parameter model in 16-bit precision must be served. Can one H100 SXM hold its weights?
> No. 70 billion × 2 bytes is about 140 GB, above the H100's 80 GB, so the weights must be split across at least two GPUs, or quantized to fewer bits.

> [!question]- Why do large training clusters give each GPU its own network link?
> Collective operations such as all-reduce move gradients between every GPU each step. Per-GPU RDMA links stop the network from becoming the bottleneck and avoid copying through host memory.

> [!question]- When is spot capacity a good fit for AI work?
> For interruptible jobs that checkpoint often, such as fine-tuning, batch inference or evaluation. It is a poor fit for latency-sensitive serving.

## Further reading

- 📝 [Building Meta's GenAI Infrastructure](https://engineering.fb.com/2024/03/12/data-center-engineering/building-metas-genai-infrastructure/) — a rare first-party account of network, storage and hardware choices at 24K-GPU scale.
- 🔬 [In-Datacenter Performance Analysis of a Tensor Processing Unit](https://arxiv.org/abs/1704.04760) — why Google built its own AI chip, with the numbers.
- 🔬 [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783) — section 3.3 is the best public data on failures in a 16K-GPU training run.
- 📄 [Introduction to Cloud TPU](https://docs.cloud.google.com/tpu/docs/intro-to-tpu) — clear guidance on when to pick CPUs, GPUs or TPUs.
- 📄 [Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/) — the Kubernetes basics of exposing and requesting GPUs.

## Related

- [[AI Scalability & Distributed Systems (Deep Dive)]] — data, tensor and pipeline parallelism on these clusters.
- [[Deployment & Serving (Deep Dive)]] — serving fleets, autoscaling and rollout.
- [[Cost Optimization (Deep Dive)]] — spot, reservations and utilization.
- [[LLM Inference & Optimization (Deep Dive)]] — batching and quantization to stretch each GPU.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — checkpointing and recovery from hardware failure.

> [!nav] Keep going
> ← [[AI Model Types (Deep Dive)|AI Model Types]] · [[AI Building Blocks|🧩 AI Building Blocks]] · [[Data Engineering & Pipelines (Deep Dive)|Data Engineering & Pipelines]] →
> 🌱 Back to the basics: [[Cloud & Infrastructure]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [What's the Difference Between a CPU and a GPU?](https://blogs.nvidia.com/blog/whats-the-difference-between-a-cpu-and-a-gpu/) — NVIDIA Blog. Article. Checked 2026-11.
[^2]: 📄 [NVIDIA H100 Tensor Core GPU](https://www.nvidia.com/en-us/data-center/h100/) — NVIDIA. Official docs. Checked 2026-11.
[^3]: 📄 [Introduction to Cloud TPU](https://docs.cloud.google.com/tpu/docs/intro-to-tpu) — Google Cloud documentation. Official docs. Checked 2026-11.
[^4]: 🔬 [In-Datacenter Performance Analysis of a Tensor Processing Unit](https://arxiv.org/abs/1704.04760) — Jouppi et al., Google, 2017. Paper. Checked 2026-11.
[^5]: 📄 [ND-H100-v5 size series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/ndh100v5-series) — Microsoft Learn, Azure Virtual Machines. Official docs. Checked 2026-11.
[^6]: 📄 [Amazon EC2 P5 Instances](https://aws.amazon.com/ec2/instance-types/p5/) — Amazon Web Services. Official docs. Checked 2026-11.
[^7]: 📝 [Building Meta's GenAI Infrastructure](https://engineering.fb.com/2024/03/12/data-center-engineering/building-metas-genai-infrastructure/) — Engineering at Meta, 2024. Engineering blog. Checked 2026-11.
[^8]: 🔬 [Language Models are Few-Shot Learners (PDF)](https://arxiv.org/pdf/2005.14165) — Brown et al., OpenAI, 2020, section 2.3. Paper. Checked 2026-11.
[^9]: 📄 [What is Amazon FSx for Lustre?](https://docs.aws.amazon.com/fsx/latest/LustreGuide/what-is.html) — Amazon FSx for Lustre User Guide. Official docs. Checked 2026-11.
[^10]: 📄 [Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/) — Kubernetes documentation. Official docs. Checked 2026-11.
[^11]: 📄 [SP 800-145, The NIST Definition of Cloud Computing](https://csrc.nist.gov/pubs/sp/800/145/final) — National Institute of Standards and Technology. Standard. Checked 2026-11.
[^12]: 📄 [Spot Instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html) — Amazon EC2 User Guide. Official docs. Checked 2026-11.
[^13]: 📄 [Deploy models with Amazon SageMaker Serverless Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^14]: 🔬 [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783) — Llama Team, Meta, 2024, sections 3.3.1 and 3.3.4. Paper. Checked 2026-11.
