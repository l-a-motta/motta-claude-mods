---
aliases: [Model Selection & Training deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Model Selection & Training]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Model Selection & Training]] › 🔬 Deep Dive

> [!tldr] For engineers
> Model selection is a **ladder of escalating cost**: heuristics, a simple baseline, a prompted foundation model, retrieval, parameter-efficient fine-tuning, full fine-tuning and, rarely, pre-training. Climb only when an eval set shows the current rung failing. Training itself is an optimization loop governed by hyperparameters, honest data splits and tracked experiments; at scale it becomes a distributed-systems problem bounded by compute (about 6 FLOPs per parameter per token) and memory (about 16 bytes per parameter for mixed-precision Adam).

> [!basics]- New to this? Start with the basics
> [[Model Selection & Training]] explains it with no jargon.

## How it really works

### The selection ladder

Google's Rules of ML open with two rules worth taking literally: launch without ML if heuristics get you most of the way, and keep the first model simple while getting the infrastructure right.[^1] For language tasks, OpenAI's accuracy guide prescribes the same discipline: start with prompt engineering, build an **eval set of questions with ground-truth answers**, and diagnose failures before escalating.[^2] If the model lacks information, it is a context ("short-term memory") problem, so add retrieval; if it has the knowledge but behaves inconsistently in format, tone or reasoning, it is a learned-memory problem, so fine-tune.[^2] The techniques stack, and for fine-tuning data, quality matters more than quantity.[^2]

### The training loop

Parameters (weights and biases) are learned; **hyperparameters** are chosen before training. The big three are learning rate (step size: too low converges slowly, too high oscillates or diverges), batch size (mini-batch SGD averages gradients over a random subset, a compromise between full-batch and single-example updates) and epochs (full passes over the data).[^3]

Generalization rests on assumptions you must protect: examples are independent and identically distributed, the data is **stationary**, and train, validation and test partitions share a distribution.[^4] Shuffle before splitting, but don't naively sort by time when data is non-stationary, and make sure seasonal patterns appear in every partition.[^4] A model that memorizes the training set and fails on new data is overfitting; watch validation loss diverge from training loss.[^4]

### Transfer learning and fine-tuning

Transfer learning reuses features learned on one problem for a similar one, typically when your dataset is too small to train from scratch.[^5] The canonical workflow: take a pre-trained model's layers, **freeze** them, add a new trainable head, train the head, then optionally unfreeze and fine-tune everything at a very low learning rate.[^5]

```python
base = keras.applications.Xception(weights="imagenet", include_top=False)
base.trainable = False                        # 1. freeze pre-trained features
model = keras.Sequential([base, keras.layers.GlobalAveragePooling2D(),
                          keras.layers.Dense(1)])
model.fit(train_ds, epochs=10)                # 2. train only the new head
base.trainable = True                         # 3. optional fine-tune
model.compile(optimizer=keras.optimizers.Adam(1e-5), loss=...)
model.fit(train_ds, epochs=10)                # tiny learning rate
```

Order matters: mixing randomly initialized layers with trainable pre-trained ones produces large gradient updates that destroy the pre-trained features.[^5]

### Parameter-efficient fine-tuning

Full fine-tuning of a large model is prohibitively costly, so PEFT methods train a small number of extra parameters and reach performance comparable to full fine-tuning, cutting compute and storage.[^6] **LoRA** freezes the pre-trained weights and injects trainable low-rank decomposition matrices into each Transformer layer, so a weight update is learned as the product of two thin matrices. Against full Adam fine-tuning of GPT-3 175B it cut trainable parameters 10,000-fold and GPU memory 3-fold, and unlike adapter layers it adds no inference latency.[^7]

### Hyperparameter search

Random search beats grid search: Bergstra and Bengio showed random trials are more efficient because for most datasets only a few hyperparameters really matter, and a grid wastes trials varying the ones that don't.[^8] Start with random or Bayesian search over log-scaled ranges, then narrow.

### Experiment tracking

Every run should be reproducible. MLflow Tracking logs parameters, metrics, code versions, start and end times and artifacts such as model weights; runs are grouped into experiments, and `mlflow.autolog()` captures most of this without explicit calls.[^9]

```python
with mlflow.start_run(run_name="lgbm-lr0.05"):
    mlflow.log_params({"learning_rate": 0.05, "num_leaves": 63})
    model = train(...)
    mlflow.log_metric("val_auc", evaluate(model, val))
```

### Distributed training

PyTorch's DistributedDataParallel runs **one process per model replica**, typically one per GPU, since a GPU can't be shared between DDP processes; autograd hooks all-reduce gradients during the backward pass so every replica applies the same update.[^10] It beats single-process DataParallel even on one machine, which suffers from GIL contention and per-step replication.[^10] Checkpoint from one rank, put a barrier before other ranks load, and use an elastic launcher for failure recovery.[^10] At the frontier, Meta ran Llama 3 jobs on 16,000 GPUs at once at over 400 TFLOPS per GPU, and built automated error detection and faster checkpoint storage to keep effective training time above 95%.[^11]

## Design choices and trade-offs

| Rung | Data you need | Gains | Costs |
| --- | --- | --- | --- |
| Heuristic or no ML | None | Ships today, fully explainable | Ceiling on quality[^1] |
| Simple model (linear, trees) | Labeled tabular data | Cheap, fast, strong baseline | Limited on text, images |
| Prompted foundation model | An eval set | No training; iterate in minutes | Per-call cost; long prompts[^2] |
| + Retrieval (RAG) | A document corpus | Fresh, citable knowledge | Retrieval tuning; noisy context can hurt[^2] |
| PEFT (LoRA) | A curated set of high-quality examples | Consistent behavior; small adapters per task | Training pipeline to run[^6] |
| Full fine-tune | More data and GPUs | Maximum adaptation | Optimizer memory for every weight[^12] |
| Pre-train from scratch | Trillions of tokens | Full control | Tens of thousands of GPUs[^11] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Training compute | C ≈ 6PD FLOPs (≈2PD forward, ≈4PD backward), P = parameters, D = tokens[^12] |
| Training memory, mixed precision + AdamW | ~16 bytes/parameter before activations (2 weights + 2 gradients + 12 optimizer state)[^12] |
| Inference memory, fp16 | ~2 bytes/parameter, ×1.2 overhead[^12] |
| Realistic A100 throughput | ~120 TFLOP/s[^12] |
| Compute-optimal scaling | Double tokens for every doubling of parameters; 70B Chinchilla beat 280B Gopher at equal compute[^13] |
| Llama 3 data vs. "optimal" | ~200B tokens is Chinchilla-optimal for 8B; trained on 15T and still improving log-linearly[^11] |
| LoRA vs. full fine-tune (GPT-3 175B) | 10,000× fewer trainable parameters, 3× less GPU memory[^7] |
| Linear models | Learnable weights scale roughly with data: ~1,000 examples supports about a dozen features[^1] |

Quick check you can do on a whiteboard: full fine-tuning a 7B model needs about 7 × 10⁹ × 16 B ≈ 112 GB for weights, gradients and optimizer state alone, more than one 80 GB GPU. That is why LoRA, sharding or both exist.

## Failure modes

- **Leaky or non-representative splits.** Random splits on time-ordered data leak the future; splits missing a season give rosy scores.[^4] Split by time when the data drifts, and audit partitions.
- **Divergence or stalls.** Loss explodes with a learning rate that is too high and crawls with one too low.[^3] Sweep it on a log scale first.
- **Destroying pre-trained knowledge.** Unfreezing too early or fine-tuning at a high learning rate overwrites useful features and overfits quickly.[^5]
- **Garbage fine-tuning data.** Low-quality or unrepresentative examples teach the wrong behavior; training examples should mirror production inputs.[^2]
- **Irreproducible wins.** An unlogged run can't be rebuilt or audited. Track every run's code, data version and parameters.[^9]
- **Entanglement.** Changing anything changes everything: a tweak to one feature, hyperparameter or sampling rule can shift the whole model, so compare against a fixed eval set every time.[^14]
- **Long-run hardware failures.** At thousands of GPUs, failures are routine; frequent, cheap checkpoints and automated restarts protect progress.[^10][^11]

## In the real world

- **Meta Llama 3** used heuristic, NSFW, semantic-deduplication and quality-classifier filters on 15T tokens, then post-trained with SFT, rejection sampling, PPO and DPO.[^11]
- **Uber Michelangelo** trains decision trees, linear models and deep networks on YARN or Mesos, offers hyperparameter search, and supports **partitioned models**, for example one per city that falls back to a country-level model.[^15]
- **Hugging Face PEFT** packages LoRA and related methods on top of Transformers.[^6]
- **MLflow** is a common open-source choice for run tracking and model registry.[^9]

## In a design interview

State the ladder, then justify the rung:

1. **Baseline:** "First a heuristic or logistic regression to set the bar and validate the data path."
2. **Candidate:** "A prompted hosted LLM, judged on a 200-question eval set with ground truth."
3. **Escalate on evidence:** "Missing knowledge, so add retrieval; inconsistent format, so LoRA on 2,000 curated examples."
4. **Budget:** "Use 6PD for compute and 16 bytes per parameter for memory to size GPUs before training."
5. **Reproducibility:** "Tracked runs, versioned data, fixed test set, one-click retrain."

Interviewers probe: *Why not fine-tune immediately?* (Cost, data needs, and prompting may suffice.) *How do you avoid leakage?* (Time-based splits, held-out test set.) *How would you tune hyperparameters?* (Random or Bayesian search on log scales.) *What if training crashes at hour 40?* (Checkpoints and elastic restarts.)

## 🧱 Builds on

- [[Trade-offs]] — each rung trades quality against latency, cost and operational burden; the eval set makes the trade explicit.
- [[Estimation]] — back-of-envelope compute (6PD), memory (16 bytes/parameter) and GPU-days before committing to a run.
- [[Concurrency]] — data-parallel worker processes, all-reduce gradient synchronization and barriers around checkpoints.

## Check yourself

> [!question]- Your fine-tuned model aces validation but fails in production. Name three likely causes.
> Leakage from a random split on time-ordered data, a validation set unlike production traffic (non-stationary or missing segments), and fine-tuning examples that don't mirror real inputs.

> [!question]- Why does LoRA add no inference latency, unlike adapter layers?
> The low-rank update is just another weight matrix, so it can be added into the frozen weights before serving. The network keeps its original shape and depth.

> [!question]- Roughly how much compute does a 1B-parameter model need for 20B tokens?
> C ≈ 6 × 10⁹ × 2 × 10¹⁰ = 1.2 × 10²⁰ FLOPs. At about 120 TFLOP/s on one A100, that is roughly 10⁶ seconds, or under two weeks.

## Further reading

- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — the pragmatic playbook: simple models, real infrastructure, honest metrics.
- 📄 [Optimizing LLM Accuracy](https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy) — when to prompt, retrieve or fine-tune, with worked examples.
- 📝 [Transformer Math 101](https://blog.eleuther.ai/transformer-math/) — the compute and memory formulas every training plan needs.
- 🔬 [LoRA](https://arxiv.org/abs/2106.09685) — the paper behind most practical fine-tuning today.
- 🔬 [Random Search for Hyper-Parameter Optimization](https://www.jmlr.org/papers/v13/bergstra12a.html) — short, convincing case against grid search.

## Related

- [[Evaluation & Metrics (Deep Dive)]] — building the eval sets that drive selection.
- [[AI Model Types (Deep Dive)]] — the families you choose between.
- [[Feature Engineering (Deep Dive)]] — inputs for classical models.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — data, tensor and pipeline parallelism at scale.
- [[Cost Optimization (Deep Dive)]] — keeping training and fine-tuning spend in check.

> [!nav] Keep going
> ← [[Data Engineering & Pipelines (Deep Dive)|Data Engineering & Pipelines]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Feature Engineering (Deep Dive)|Feature Engineering]] →
> 🌱 Back to the basics: [[Model Selection & Training]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, Rules #1, #4 and #21. Official docs. Checked 2026-11.
[^2]: 📄 [Optimizing LLM Accuracy](https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy) — OpenAI API documentation. Official docs. Checked 2026-11.
[^3]: 🎓 [Linear regression: Hyperparameters](https://developers.google.com/machine-learning/crash-course/linear-regression/hyperparameters) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^4]: 🎓 [Overfitting](https://developers.google.com/machine-learning/crash-course/overfitting/overfitting) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^5]: 📄 [Transfer learning & fine-tuning](https://keras.io/guides/transfer_learning/) — Keras developer guides. Official docs. Checked 2026-11.
[^6]: 📄 [PEFT](https://huggingface.co/docs/peft/index) — Hugging Face documentation. Official docs. Checked 2026-11.
[^7]: 🔬 [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685) — Hu et al., arXiv 2021. Paper. Checked 2026-11.
[^8]: 🔬 [Random Search for Hyper-Parameter Optimization](https://www.jmlr.org/papers/v13/bergstra12a.html) — Bergstra and Bengio, JMLR 13, 2012. Paper. Checked 2026-11.
[^9]: 📄 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) — MLflow documentation. Official docs. Checked 2026-11.
[^10]: 📄 [Getting Started with Distributed Data Parallel](https://docs.pytorch.org/tutorials/intermediate/ddp_tutorial.html) — PyTorch tutorials. Official docs. Checked 2026-11.
[^11]: 📝 [Introducing Meta Llama 3](https://ai.meta.com/blog/meta-llama-3/) — Meta AI, April 2024. Engineering blog. Checked 2026-11.
[^12]: 📝 [Transformer Math 101](https://blog.eleuther.ai/transformer-math/) — Anthony, Biderman and Schoelkopf, EleutherAI, 2023. Article. Checked 2026-11.
[^13]: 🔬 [Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556) — Hoffmann et al., arXiv 2022. Paper. Checked 2026-11.
[^14]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., Google, NeurIPS 2015, section 2. Paper. Checked 2026-11.
[^15]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
