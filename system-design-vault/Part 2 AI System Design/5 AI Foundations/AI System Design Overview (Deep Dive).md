---
aliases: [AI System Design Overview deep dive]
tags: [level/deep-dive, part/2, section/ai-foundations]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Foundations]]"
basics: "[[AI System Design Overview]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Foundations]] › [[AI System Design Overview]] › 🔬 Deep Dive

> [!tldr] For engineers
> An AI system is a distributed system whose core behavior is **learned from data** rather than specified. It inherits every classic concern and adds three: data is a first-class dependency with no compiler to check it, quality is statistical and degrades silently, and the system changes along **three axes (code, model, data)**. Most design effort goes to the pipelines, serving and monitoring around a small model; LLM platforms add context construction, guardrails and gateways but keep the same skeleton.

> [!basics]- New to this? Start with the basics
> [[AI System Design Overview]] explains it with no jargon.

## How it really works

### What changes when behavior is learned

Google's "Hidden Technical Debt" paper is the standard starting point. Its Figure 1 shows the ML code as a small box inside surrounding infrastructure that is "vast and complex", and its sections trace where the debt hides: data dependencies, pipeline jungles, configuration and monitoring.[^1] The paper estimates that a mature system "might end up being (at most) 5% machine learning code and (at least) 95% glue code."[^1]

The debt comes from properties code doesn't have:

- **Entanglement (CACE).** "Changing Anything Changes Everything": shift one feature's distribution and the weights of all the others can move. The same holds for hyperparameters, sampling and data selection.[^1]
- **Data dependencies cost more than code dependencies.** Compilers and linkers find code dependencies; nothing equivalent finds data dependencies, so long, fragile chains build up unnoticed.[^1]
- **Feedback loops.** A live model influences the data it will later be trained on, directly (recommendations shape clicks) or through other systems in the world.[^1]

Microsoft's study of its own teams reached the same place from the process side. It named three things that make AI "fundamentally different": data discovery, management and versioning is harder; model customization needs skills software teams rarely have; and models are hard to treat as modules because they are "entangled" and show "non-monotonic error behavior".[^2] Non-monotonic means improving one model can lower end-to-end quality, because downstream models were tuned to the old one's errors.[^2]

Google's ML Test Score paper gives the cleanest mental model. Treat training like **compilation where the source is code plus training data**. Then data needs testing like code, and a trained model needs what a binary needs: debuggability, rollbacks and monitoring.[^3]

### The lifecycle

Google's MLOps reference lists eight steps: data extraction, analysis, preparation, training, evaluation, validation against a baseline, serving and monitoring.[^4] Microsoft's version has nine stages, starting with **model requirements** (is this feasible with ML, and which model type fits?), and loops: evaluation and monitoring can send work back to any earlier stage.[^2]

Because code, model and data each change independently, a release is really a tuple.[^5] Pinning all three is what makes a result reproducible:

```yaml
# What a "release" of an ML service actually pins
release: eta-model-2026-11-01
code:   git:4f2a9c1            # training + serving code, one repo
data:   snapshot://trips/2026-10-31   # exact training snapshot
model:  registry://eta@v42     # artifact, metrics, lineage
config: features.yaml@4f2a9c1  # feature list, thresholds
```

### Maturity levels

Google describes three levels.[^4] **Level 0** is manual: notebooks, scripts, hand-off of a model file, rare releases, little monitoring. **Level 1** automates the training pipeline so the system can do **continuous training (CT)**, "a new property, unique to ML systems," with automated data and model validation and a metadata store.[^4] **Level 2** adds full CI/CD for the pipeline itself, so teams can ship new pipeline components quickly.[^4]

### The LLM-era version

Applications built on hosted foundation models keep the loop but move the work. Chip Huyen's reference architecture starts from the simplest setup, a query sent straight to a model, and adds components only as needed: context construction (RAG), input and output guardrails, a model router and gateway, caches, write actions, observability and orchestration.[^6] Anthropic gives the same advice for agents: find "the simplest solution possible," because agentic systems "trade latency and cost for better task performance."[^7] Data still matters, but as retrieved context and evaluation sets more than as training data.

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Heuristic or rules instead of ML | Predictable, cheap, explainable | Complex heuristics become unmaintainable[^8] |
| Simple first model | Fast to ship; the first model gives the biggest boost[^8] | Surfaces more infrastructure issues than expected[^8] |
| Generic ML package plus glue | Quick start | Glue freezes the system to one package's quirks[^1] |
| Static training (train once) | Simple to build and test | Goes stale as the world shifts[^4] |
| Continuous training | Tracks drift | Needs automated validation, pipelines, metadata[^4] |
| Several chained models | Each part is simpler | Entanglement; non-monotonic error[^2] |
| Fixed LLM workflow | Predictable, debuggable | Less flexible on open-ended tasks[^7] |
| Autonomous agent | Handles open-ended tasks | Higher latency and cost[^7] |

The recurring question is how much of the system you let learn. Every learned part buys flexibility and pays in testability.

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Share of ML code in a mature system (estimate) | At most ~5%; glue at least ~95%[^1] |
| Production-readiness tests in Google's rubric | 28[^3] |
| Google teams implementing any one of those tests | None above 80%[^3] |
| Microsoft study size | 14 interviews; 551 survey responses from 4,195 invited[^2] |
| Booking.com customer-facing models analyzed | ~150[^9] |
| Booking.com: cost of ~30% more latency | ~0.5% conversion[^9] |
| Uber Michelangelo (2024): models in production | 5,000+[^10] |
| Uber Michelangelo (2024): peak real-time predictions | 10 million per second[^10] |
| Knight Capital loss blamed on obsolete experimental code paths | $465M in 45 minutes[^1] |

## Failure modes

- **Training-serving skew.** Features computed one way in the training pipeline and another way at serving time. The ML Test Score calls this test "the most important and least implemented."[^3] Defense: share feature code between the two paths and log serving features for training.[^8]
- **Silent failures and staleness.** A stale or broken model keeps answering. Rules of ML warns about silent failures specifically.[^8] Defense: know your freshness requirement, alert on model age and on prediction quality.[^3]
- **Unstable upstream data.** Another team "fixes" a miscalibrated signal and your model, which learned the old calibration, breaks.[^1] Defense: version the signal, and alert on dependency changes.[^1][^3]
- **Hidden feedback loops and undeclared consumers.** Systems influence each other through the world, or silently consume your model's output.[^1] Defense: access restrictions or SLAs on model outputs, and some randomization in what the model chooses.[^1]
- **Proxy metric divergence.** Offline gains don't move business metrics; Booking.com saw this repeatedly.[^9] Defense: decide launches with online experiments.[^9]
- **Dead experimental code paths.** Abandoned branches pile up complexity; Knight Capital is the cautionary tale.[^1]

Two cheap monitors catch a lot. **Prediction bias**: the distribution of predicted labels should match observed labels, and a sudden gap means the world changed.[^1] **Action limits**: cap what an automated system can do (bids, spam flags) and page a human when a cap trips.[^1]

## In the real world

- **Uber Michelangelo** went from tabular predictive models (launched early 2016), to deep learning, to a Gen AI Gateway with logging, cost guardrails and PII redaction.[^10]
- **Google** built the ML Test Score from systems such as ad click prediction and the Sibyl platform,[^3] and published its engineering lessons as the Rules of ML.[^8]
- **Microsoft**, whose ML products include Bing Search and Cortana, studied its own teams to derive the nine-stage workflow.[^2]
- **Booking.com** validated about 150 models through randomized controlled trials and found model gains and business gains often diverge.[^9]
- **Thoughtworks** framed Continuous Delivery for ML (CD4ML) around versioning code, data and model together.[^5]

## In a design interview

Interviewers want to see that you design the system, not just pick a model. A skeleton:

1. **Goal and metric.** "The business goal is X; we'll judge success by Y online, with Z as the offline proxy."
2. **Is ML needed?** "Baseline is a heuristic; ML must beat it by enough to pay for its upkeep."
3. **Data.** Sources, labels, freshness, and whether every feature exists at prediction time.
4. **Model.** Start simple; name the upgrade path.
5. **Serving.** Online or batch, latency budget, fallback when the model is down.
6. **Monitoring and retraining.** Skew, drift, model age, business metrics; what triggers retraining.
7. **Risks.** Feedback loops, safety, privacy, cost.

Expect probes like: *How do you know the model got worse?* *What happens when an upstream feature changes?* *How do you roll back?* *Why not just call an LLM API?*

## 🧱 Builds on

- [[Requirements]] — functional and non-functional requirements gain a third kind: quality targets on a statistical output.
- [[Trade-offs]] — accuracy, latency, cost and testability; every learned component trades testability for flexibility.
- [[High-Level Design]] — the same component diagram, plus pipelines, a model registry and a feedback arrow from monitoring to training.

## Check yourself

> [!question]- Why can improving one model make an end-to-end AI system worse?
> Models are entangled. Downstream components were tuned to the old model's outputs and errors, so a "better" upstream model can shift inputs in ways they don't handle. Microsoft calls this non-monotonic error.

> [!question]- What is the difference between MLOps level 0 and level 1?
> Level 0 hands off a trained model manually and retrains rarely. Level 1 automates the training pipeline with data and model validation, so the system retrains continuously and ships the pipeline, not just a model.

> [!question]- Why does "training is compilation" imply you should test data?
> If the source of a model is code plus data, a data bug is a source bug. Schemas, invariants and skew checks on data play the role unit tests play for code.

## Further reading

- 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — the paper that named ML-specific debt; short and still accurate.
- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml/) — numbered, practical rules from Google's production experience.
- 🔬 [The ML Test Score](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — a checklist you can score your own system against.
- 📄 [MLOps: Continuous delivery and automation pipelines in ML](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — the maturity levels with architecture diagrams.
- 📝 [Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html) — how the same ideas look for LLM applications.

## Related

- [[Business Goals & Requirements (Deep Dive)]] — metric hierarchies and error costs.
- [[AI Architecture Layers (Deep Dive)]] — data, model, serving and monitoring in detail.
- [[MLOps & CI-CD (Deep Dive)]] — automating continuous training and delivery.
- [[AI Monitoring & Observability (Deep Dive)]] — skew, drift and quality monitoring.
- [[Retrieval-Augmented Generation (Deep Dive)]] — context construction in LLM systems.
- [[AI Agents & Tool Use (Deep Dive)]] — when to let the model drive.

> [!nav] Keep going
> ← [[Case Studies (Deep Dive)|Case Studies]] · [[AI Foundations|🎯 AI Foundations]] · [[Business Goals & Requirements (Deep Dive)|Business Goals & Requirements]] →
> 🌱 Back to the basics: [[AI System Design Overview]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., NeurIPS 2015. Paper. Checked 2026-11.
[^2]: 🔬 [Software Engineering for Machine Learning: A Case Study](https://www.microsoft.com/en-us/research/uploads/prod/2019/03/amershi-icse-2019_Software_Engineering_for_Machine_Learning.pdf) — Amershi et al., Microsoft Research, ICSE-SEIP 2019. Paper. Checked 2026-11.
[^3]: 🔬 [The ML Test Score: A Rubric for ML Production Readiness and Technical Debt Reduction](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — Breck et al., Google, IEEE Big Data 2017. Paper. Checked 2026-11.
[^4]: 📄 [MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — Google Cloud Architecture Center. Official docs. Checked 2026-11.
[^5]: 📝 [Continuous Delivery for Machine Learning](https://martinfowler.com/articles/cd4ml.html) — Sato, Wider and Windheuser, martinfowler.com. Article. Checked 2026-11.
[^6]: 📝 [Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html) — Chip Huyen. Article. Checked 2026-11.
[^7]: 📝 [Building effective agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^8]: 📄 [Rules of Machine Learning: Best Practices for ML Engineering](https://developers.google.com/machine-learning/guides/rules-of-ml/) — Martin Zinkevich, Google for Developers. Official docs. Checked 2026-11.
[^9]: 📝 [150 successful machine learning models: 6 lessons learned at Booking.com](https://blog.acolyer.org/2019/10/07/150-successful-machine-learning-models/) — Adrian Colyer, The Morning Paper, summarizing Bernardi et al., KDD 2019. Article. Checked 2026-11.
[^10]: 📝 [From Predictive to Generative: How Michelangelo Accelerates Uber's AI Journey](https://www.uber.com/blog/from-predictive-to-generative-ai/) — Uber Engineering. Engineering blog. Checked 2026-11.
