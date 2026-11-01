---
aliases: [Deployment & Serving deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Deployment & Serving]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Deployment & Serving]] › 🔬 Deep Dive

> [!tldr] For engineers
> Serving is a latency-throughput-cost problem wrapped around a versioned artifact. Pick the mode from the traffic shape (real-time, serverless, asynchronous, batch), raise accelerator utilization with server-side batching, and never cut over in one step: shadow the new model on copied traffic, canary it on a small share, then promote or roll back automatically on metrics.

> [!basics]- New to this? Start with the basics
> [[Deployment & Serving]] explains it with no jargon.

## How it really works

### The serving path

A deployed model is a **versioned artifact** loaded into a model server process, which sits behind a router. The request path is: client → gateway or load balancer → model server (feature lookup, pre-processing, forward pass, post-processing) → response. Uber's Michelangelo shows the pattern: each trained model is stored with its config, metrics and parameters and addressed at serving time by a UUID or a **tag**; deploying a new model with the same feature signature to the same tag switches traffic without any client change.[^1] Online prediction runs on a cluster of hundreds of machines behind a load balancer, and clients call it over RPC.[^1]

### Choosing a serving mode

The traffic shape picks the mode. Amazon SageMaker's four options make the trade-offs concrete:[^2]

| Mode | Best for | Payload limit | Time limit | Scale to zero |
| --- | --- | --- | --- | --- |
| Real-time endpoint | Sustained, low-latency traffic | 25 MB | 60 s (8 min streaming) | No |
| Serverless | Intermittent, unpredictable traffic | 4 MB | 60 s | Yes |
| Asynchronous | Large payloads, long jobs, queued | 1 GB | 1 hour | Yes |
| Batch transform | Offline scoring of a dataset | GB-scale datasets | Days | No endpoint |

Serverless trades control for convenience. Memory ranges from 1 to 6 GB with vCPUs allocated in proportion, a single endpoint caps at 200 concurrent invocations, and GPUs are not supported.[^3] After an idle period, the first requests pay a **cold start** whose length depends on model size, download time and container start-up; provisioned concurrency keeps capacity warm for a fee.[^3]

### Server-side batching

GPUs are most efficient on batches, but online requests arrive one at a time. NVIDIA Triton's **dynamic batcher** merges individual requests into server-side batches, which typically increases throughput.[^4] With the default config it forms the largest batch available without waiting; `max_queue_delay_microseconds` lets requests wait a bounded time for company, trading latency for throughput.[^4]

```protobuf
# Triton model config (config.pbtxt)
max_batch_size: 32
dynamic_batching {
  max_queue_delay_microseconds: 2000   # wait up to 2 ms to fill a batch
}
```

Stateful models need the **sequence batcher**, which pins a sequence of requests to one model instance; its iterative mode enables continuous (in-flight) batching for LLM workloads.[^4]

### LLM serving

LLM decoding keeps a **KV cache** per request that grows token by token. Kwon et al. showed that naive allocation wastes much of that memory through fragmentation and duplication, which limits batch size. **PagedAttention** stores the cache in fixed-size blocks, like OS virtual-memory pages, and vLLM built on it delivers 2 to 4 times the throughput of FasterTransformer and Orca at the same latency.[^5] See [[LLM Inference & Optimization (Deep Dive)]] for the full set of techniques.

### Rolling out a new model

Google's MLOps reference architecture puts a newly trained model through online validation, in a **canary deployment or an A/B testing setup**, before it serves all traffic.[^6]

**Canary.** Deploy the new version beside the old one, route a small share of users to it, grow the share as confidence builds, and route everyone back if something breaks.[^7] Facebook's first canary is visible only to employees; IMVU's "cluster immune system" rolled back automatically on a statistically significant regression in business metrics.[^7] In KServe the split is one field:[^8]

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: fraud-model
spec:
  predictor:
    canaryTrafficPercent: 10          # 10% to the new revision
    model:
      modelFormat: { name: sklearn }
      storageUri: gs://models/fraud/v2
```

KServe sends the other 90% to the **last good revision**, the last one rolled out to 100%. Promotion makes the new revision take all traffic; rollback pins 100% to the previous healthy revision. Canary rollout is supported only in KServe's serverless deployment mode.[^8]

**Shadow.** SageMaker deploys the candidate as a shadow variant on the same endpoint and routes a **copy** of live requests to it in real time; only the production variant's responses go back to callers, and shadow responses can be logged for offline comparison.[^9] It validates a new model, a new container (say, a security patch) or a new instance type against real traffic with no user impact.[^9]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Real-time endpoint | Low latency; instance type of your choice[^2] | Pay for idle capacity |
| Serverless | Pay per use; scales to zero[^3] | Cold starts; no GPUs; 4 MB payloads[^3] |
| Asynchronous | Large inputs; queue absorbs bursts[^2] | Caller must poll or be notified |
| Batch | Cheapest per prediction; simple[^2] | Results are stale until the next run |
| Embedded library (Uber's Java API mode)[^1] | No network hop | Model updates ride the host service's releases |
| Larger batch delay | Higher GPU throughput[^4] | Higher tail latency[^4] |
| Shadow test | Zero user risk; real traffic[^9] | Doubles compute; can't measure user reaction |
| Canary | Real user signal; fast rollback[^7] | Some users see a bad model briefly |
| A/B test | Measures business impact[^7] | Days of traffic to reach significance[^7] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| SageMaker real-time payload / timeout | 25 MB / 60 s (8 min streaming)[^2] |
| SageMaker asynchronous payload / timeout | 1 GB / 1 hour[^2] |
| SageMaker serverless memory range | 1 to 6 GB[^3] |
| SageMaker serverless max concurrency per endpoint | 200[^3] |
| Uber Michelangelo p95 latency | Under 5 ms; under 10 ms with Cassandra-served features[^1] |
| Uber's highest-traffic models | Over 250,000 predictions per second[^1] |
| vLLM throughput vs. FasterTransformer and Orca | 2 to 4 times at the same latency[^5] |
| Triton default batching delay | None: forms the largest available batch immediately[^4] |

## Failure modes

- **Training-serving skew.** Features computed differently in the serving path than in training make a model that validated well underperform live. Google's fix is to log the features actually used at serving time and train on them.[^10]
- **Bad release.** A canary catches regressions while the blast radius is small; automate rollback on metric regression, as IMVU did.[^7]
- **Cold starts.** Scale-to-zero endpoints stall on the first request after idle. Use provisioned concurrency or an always-on endpoint for latency-critical paths, and watch the overhead-latency metric.[^3]
- **Throttling.** Requests beyond a serverless endpoint's maximum concurrency are throttled.[^3] Load-test and set limits per endpoint.
- **GPU memory exhaustion.** Long LLM contexts blow up the KV cache and cap batch size; paged allocation reduces waste.[^5]
- **Silent staleness.** Without logged predictions there is no way to detect decay; MLOps level 0 lacks this monitoring entirely.[^6]

## In the real world

- **Uber Michelangelo** serves online models from containers behind load balancers, runs batch predictions as Spark jobs, and uses tags for zero-client-change rollouts.[^1]
- **NVIDIA Triton** is NVIDIA's inference server, with dynamic and sequence batchers.[^4]
- **vLLM** is the LLM serving system built on PagedAttention.[^5]
- **KServe** provides canary rollouts for models on Kubernetes.[^8]
- **Amazon SageMaker** offers managed real-time, serverless, asynchronous and batch serving plus built-in shadow tests.[^2][^9]

## In a design interview

Start from the latency budget and the traffic shape, then walk the path.

1. **Mode.** "Checkout fraud scoring needs under 50 ms at p99 with steady traffic, so a real-time endpoint on always-on instances."
2. **Path.** "API gateway, load balancer, stateless model servers with features from an online store; the model is versioned and addressed by tag."
3. **Efficiency.** "GPU servers with dynamic batching and a 1 to 2 ms queue delay; autoscale on requests in flight."
4. **Rollout.** "Shadow for a day to compare latency and error rate, canary at 5%, then an A/B test on chargeback rate; automatic rollback on guardrail breach."
5. **Fallback.** "If the model times out, fall back to rules or the previous version."

Probes: *Batch or online?* (Does anyone wait for the answer?) *How do you roll back?* (Route back to the last good version; keep it warm.) *How do you know the canary is healthy?* (Latency, errors, prediction distribution, business guardrails.)

## 🧱 Builds on

- [[API Design (Deep Dive)]] — the model is a versioned API; Uber's tag-based addressing lets models change behind a stable contract.[^1]
- [[Load Balancing (Deep Dive)]] — weighted routing implements the canary split and spreads requests across model replicas.[^8]
- [[Microservices (Deep Dive)]] — each model runs as an independently deployable prediction service called by other services.[^6]
- [[Serverless (Deep Dive)]] — serverless inference inherits scale-to-zero, per-use billing and cold starts.[^3]

## Check yourself

> [!question]- Your serverless endpoint meets its p50 target but p99 is terrible after quiet periods. What is happening and what are the fixes?
> Cold starts: scaled-to-zero capacity has to start and load the model. Use provisioned concurrency, switch to an always-on endpoint, or shrink the model and container to cut start-up time.

> [!question]- Raising Triton's max_queue_delay doubled throughput but broke your SLO. Why?
> Requests now wait in the queue to form bigger batches, which adds directly to latency. Lower the delay or add instances; tune the delay against the latency budget, not throughput alone.

> [!question]- Why run a shadow test before a canary rather than instead of one?
> Shadow proves the new model and stack handle real traffic with zero user risk, but its answers are never seen, so it can't measure user impact. The canary then measures real behavior on a small share.

## Further reading

- 📄 [Inference options in Amazon SageMaker AI](https://docs.aws.amazon.com/sagemaker/latest/dg/deploy-model-options.html) — a compact map of serving modes and their limits.
- 📄 [Batchers: NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/archives/triton-inference-server-2670/user-guide/docs/user_guide/batcher.html) — how dynamic and sequence batching actually behave.
- 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — the vLLM paper behind modern LLM serving.
- 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/en-US/blog/michelangelo-machine-learning-platform/) — an end-to-end production serving platform, with real numbers.
- 📝 [Canary Release](https://www.martinfowler.com/bliki/CanaryRelease.html) — the classic short explanation, including how it differs from A/B testing.

## Related

- [[LLM Inference & Optimization (Deep Dive)]] — KV caches, quantization and batching for LLMs.
- [[Evaluation & Metrics (Deep Dive)]] — the metrics that gate a canary.
- [[MLOps & CI-CD (Deep Dive)]] — pipelines that build and ship model artifacts.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — serving models too big for one GPU.
- [[Cost Optimization (Deep Dive)]] — picking modes and hardware for cost.

> [!nav] Keep going
> ← [[Evaluation & Metrics (Deep Dive)|Evaluation & Metrics]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[AI Scalability & Distributed Systems (Deep Dive)|AI Scalability & Distributed Systems]] →
> 🌱 Back to the basics: [[Deployment & Serving]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/en-US/blog/michelangelo-machine-learning-platform/) — Del Balso and Hermann, Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^2]: 📄 [Inference options in Amazon SageMaker AI](https://docs.aws.amazon.com/sagemaker/latest/dg/deploy-model-options.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^3]: 📄 [Deploy models with Amazon SageMaker Serverless Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^4]: 📄 [Batchers: NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/archives/triton-inference-server-2670/user-guide/docs/user_guide/batcher.html) — NVIDIA Triton user guide (2.67 archive). Official docs. Checked 2026-11.
[^5]: 🔬 [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) — Kwon et al., SOSP 2023. Paper. Checked 2026-11.
[^6]: 📄 [MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — Google Cloud Architecture Center. Official docs. Checked 2026-11.
[^7]: 📝 [Canary Release](https://www.martinfowler.com/bliki/CanaryRelease.html) — Danilo Sato, martinfowler.com, 2014. Article. Checked 2026-11.
[^8]: 📄 [Canary Rollout Strategy](https://kserve.github.io/website/docs/model-serving/predictive-inference/rollout-strategies/canary) — KServe documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Shadow tests](https://docs.aws.amazon.com/sagemaker/latest/dg/shadow-tests.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^10]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Google for Developers. Official docs. Checked 2026-11.
