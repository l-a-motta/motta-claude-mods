---
aliases: [AI Architecture Layers deep dive]
tags: [level/deep-dive, part/2, section/ai-foundations]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Foundations]]"
basics: "[[AI Architecture Layers]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Foundations]] › [[AI Architecture Layers]] › 🔬 Deep Dive

> [!tldr] For engineers
> Data, model, serving and monitoring is a useful split because each layer has its own artifacts (features, trained models plus metadata, endpoints, metrics and alerts), its own release cadence and its own failure modes. The **seams** matter more than the boxes: feature definitions shared by training and serving, a model registry between training and serving, and prediction logs joined back to outcomes. Most production ML bugs are skew at one of those seams.

> [!basics]- New to this? Start with the basics
> [[AI Architecture Layers]] explains it with no jargon.

## How it really works

The four layers are this vault's organizing frame, not a standard. They map cleanly onto vendor lifecycles. AWS lists business goal, problem framing, data processing, model development, deployment and monitoring; the last four are the four layers.[^1] Google's eight MLOps steps group the same way.[^2]

### Data layer

The data layer turns raw events into **features** that are identical for training and serving.

- **Ingestion.** At Uber, transactional and log data flows into an HDFS data lake, and Kafka brokers aggregate logged messages from all services.[^3]
- **Validation.** Encode expectations in a schema and check every batch against it; the ML Test Score's first data test uses the example that an adult's height is surely between one and ten feet.[^4] Google's level 1 MLOps adds automated data validation to the pipeline.[^2]
- **Feature store.** Feast separates an **offline store** for "historical feature extraction used in model training" from an **online store** for "serving features at low-latency."[^5] It builds **point-in-time correct** training sets so future values don't leak into training.[^5]

```python
# Point-in-time join: for each label, use the feature value as it was
# at label time, never a later one (that would leak the future).
def point_in_time_join(labels, history):
    rows = []
    for entity, ts, label in labels:
        past = [f for f in history[entity] if f.ts <= ts]
        value = max(past, key=lambda f: f.ts).value if past else None
        rows.append((entity, ts, value, label))
    return rows
```

Without this discipline, data prep becomes what Google calls a **pipeline jungle** of scrapes, joins and intermediate files that is hard to test and recover.[^6]

### Model layer

The model layer turns features into a versioned, validated artifact.

- **Training pipeline.** Train, evaluate on a holdout set, then validate that the model beats a baseline before it may ship.[^2]
- **Cadence.** Static training is simpler but goes stale; dynamic training adapts but must build, test and release new models regularly.[^7]
- **Metadata.** A metadata store records each pipeline run: component versions, parameters, artifact locations and evaluation metrics, which gives lineage and reproducibility.[^2]
- **Registry.** MLflow's registry gives each model incrementing versions, links each version to the run that produced it, and supports **aliases** such as `champion` that serving resolves at load time (`models:/MyModel@champion`).[^8] Uber serves models by UUID plus an optional tag; with a tag, the container uses the latest model deployed to it.[^3]

### Serving layer

The serving layer answers requests within a latency and cost budget.

- **Batch (static) inference** precomputes predictions. It is cheap and can be checked before publishing, but it only covers inputs you anticipated and its "update latency is likely measured in hours or days."[^9]
- **Online (dynamic) inference** predicts on request. It handles any input but is "compute intensive and latency sensitive," and its monitoring needs are heavier.[^9]
- **Managed variants.** SageMaker offers real-time endpoints for interactive low-latency work, serverless endpoints for spiky traffic that "can tolerate cold starts," and asynchronous endpoints for payloads up to 1 GB and processing up to one hour.[^10]
- **At Uber**, online models run in a prediction service cluster behind a [[Load Balancing|load balancer]] and are called over RPC; offline models run as Spark batch jobs.[^3] Online models read precomputed features from Cassandra, a [[NoSQL Databases|NoSQL database]].[^3] Teams A/B test by deploying competing models under different UUIDs or tags.[^3]

For LLM applications the serving layer gains a **gateway and router** (one interface to many models, sending simple queries to cheaper ones), caches and input/output guardrails.[^11] Uber's Gen AI Gateway centralizes access to external and in-house LLMs with logging, cost guardrails and PII redaction.[^12]

### Monitoring layer

The monitoring layer closes the loop. The ML Test Score lists seven monitoring tests: dependency changes notify owners, data invariants hold in training and serving, training and serving features compute the same values, models are not too stale, the model is numerically stable, computational performance hasn't regressed, and prediction quality on served data hasn't regressed.[^4]

Uber's version: log predictions (optionally holding back a percentage), join them later with observed outcomes, and push live accuracy metrics to time-series monitoring with threshold alerts.[^3] A cheap extra check is **prediction bias**: the distribution of predicted labels should match observed labels.[^6] Alerts on drift then trigger the training pipeline, which is what Google's level 1 automates.[^2]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Batch inference | Cheap; verify before publishing | Only anticipated inputs; hours-to-days stale[^9] |
| Online inference | Any input, fresh features | Latency-sensitive; heavier monitoring[^9] |
| Serverless endpoint | No infrastructure to manage; suits traffic with idle periods | Cold starts[^10] |
| Async endpoint | Large payloads, long jobs | Not interactive[^10] |
| Feature store | One definition for training and serving; reuse | Another stateful system to run |
| Static training | Simple; build and test once | Goes stale[^7] |
| Dynamic training | Tracks drift | Continuous build, test and release work[^7] |
| Shared ML platform | Standard path to production | A platform team to fund; less per-team freedom |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Uber feature store size (2017) | ~10,000 features, recomputed daily[^3] |
| Uber online serving P95 (2017) | < 5 ms; < 10 ms with Cassandra features[^3] |
| Uber highest-traffic models (2017) | > 250,000 predictions per second[^3] |
| Uber Michelangelo (2024) | 5,000+ models in production; 10M predictions/s at peak[^12] |
| Uber training volume (2024) | ~400 active projects; 20K+ training jobs per month[^12] |
| SageMaker async inference limits | 1 GB payload; up to 1 hour of processing[^10] |
| Batch inference freshness | Hours or days[^9] |
| ML Test Score | 28 tests: 7 each for data, model, infrastructure, monitoring[^4] |

## Failure modes

- **Training-serving skew.** Features computed differently in each path. The ML Test Score calls its skew test "the most important and least implemented."[^4] Defense: one feature definition, and log serving features to train on.[^13]
- **Leakage.** A naive join hands the model future information that won't exist at serving time. Defense: point-in-time joins.[^5]
- **Wrong model live.** Serving pins a file path instead of a registry version. Defense: deploy by alias and keep lineage from version to run.[^8]
- **Silent staleness.** The training pipeline breaks and an old model keeps serving. Defense: alert on model age.[^4]
- **Upstream change.** A source system changes a field's meaning. Defense: dependency-change notifications and schema checks.[^4]
- **Performance regressions.** A new model is more accurate but slower or larger. Defense: monitor latency, throughput and RAM per version.[^4]
- **Cold starts.** Serverless endpoints add latency after idle periods.[^10]

## In the real world

- **Uber Michelangelo** is the reference end-to-end platform: data lake, Kafka, Samza streaming features, Cassandra online store, Spark batch, and online serving behind a load balancer.[^3] By 2024 it covered gen AI too.[^12]
- **Feast** is the common open-source feature store, with pluggable offline and online stores.[^5]
- **MLflow** is the common open-source model registry.[^8]
- **SageMaker** and Google's MLOps reference show how cloud providers package the same layers as managed services.[^10][^2]
- **LLM platforms** add context construction, guardrails, routing and caching around a hosted model.[^11]

## In a design interview

Draw the four layers left to right, then spend your time on the arrows:

1. **Data → model:** "Features come from a store with point-in-time joins; training reads the offline store."
2. **Model → serving:** "Validated models go to a registry; serving loads the `champion` alias; rollback is moving the alias."
3. **Serving mode:** "Online, because inputs are unpredictable and the latency budget is X ms; nightly batch for the long tail."
4. **Serving → monitoring:** "Log features and predictions, join with labels when they arrive, alert on skew, drift, model age and latency."
5. **Monitoring → data/model:** "Alerts trigger the retraining pipeline."

Probes: *How do you guarantee training and serving use the same features?* *Labels arrive after a week; how do you monitor quality meanwhile?* *How do you roll back a bad model in a minute?*

## 🧱 Builds on

- [[High-Level Design]] — the four layers are a high-level component diagram whose interfaces are data contracts.
- [[Microservices]] — a served model is commonly deployed as its own microservice, as in Google's MLOps reference and Uber's prediction cluster.[^2][^3]
- [[Message Queues]] — at Uber, Kafka brokers aggregate logged messages from all services, and Samza streaming jobs turn them into near-real-time features.[^3]

## Check yourself

> [!question]- Why does a feature store have both an offline and an online store?
> Training needs large historical, point-in-time correct reads; serving needs single-row reads in milliseconds. One definition feeds both, so the values match.

> [!question]- When is batch inference the wrong choice?
> When inputs can't be enumerated ahead of time (free-text queries, new items) or answers must reflect state from the last few seconds.

> [!question]- Your labels arrive seven days late. What do you monitor in the meantime?
> Input data invariants, training-serving skew, prediction distribution versus history, model age and serving performance. They catch most failures before labels confirm quality.

## Further reading

- 📄 [MLOps: Continuous delivery and automation pipelines in ML](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — the layers as automated pipelines, with diagrams.
- 📝 [Meet Michelangelo](https://www.uber.com/en-AU/blog/michelangelo-machine-learning-platform/) — the most detailed public write-up of a full ML platform.
- 🔬 [The ML Test Score](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — a per-layer checklist of tests and monitors.
- 📄 [Feast documentation](https://docs.feast.dev/) — offline and online stores and point-in-time joins.
- 📝 [Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html) — how the layers look for LLM apps.

## Related

- [[Data Engineering & Pipelines (Deep Dive)]] — the data layer.
- [[Feature Engineering (Deep Dive)]] — what goes into the feature store.
- [[Model Selection & Training (Deep Dive)]] — the model layer.
- [[Deployment & Serving (Deep Dive)]] — the serving layer.
- [[AI Monitoring & Observability (Deep Dive)]] — the monitoring layer.
- [[MLOps & CI-CD (Deep Dive)]] — automating the arrows between layers.

> [!nav] Keep going
> ← [[Business Goals & Requirements (Deep Dive)|Business Goals & Requirements]] · [[AI Foundations|🎯 AI Foundations]] · [[Data Sources (Deep Dive)|Data Sources]] →
> 🌱 Back to the basics: [[AI Architecture Layers]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Well-Architected machine learning lifecycle](https://docs.aws.amazon.com/wellarchitected/latest/machine-learning-lens/machine-learning-lifecycle.html) — AWS Well-Architected Machine Learning Lens. Official docs. Checked 2026-11.
[^2]: 📄 [MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — Google Cloud Architecture Center. Official docs. Checked 2026-11.
[^3]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/en-AU/blog/michelangelo-machine-learning-platform/) — Uber Engineering. Engineering blog. Checked 2026-11.
[^4]: 🔬 [The ML Test Score: A Rubric for ML Production Readiness and Technical Debt Reduction](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — Breck et al., Google, IEEE Big Data 2017. Paper. Checked 2026-11.
[^5]: 📄 [Introduction to Feast](https://docs.feast.dev/) — Feast documentation. Official docs. Checked 2026-11.
[^6]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., NeurIPS 2015. Paper. Checked 2026-11.
[^7]: 🎓 [Production ML systems: Static versus dynamic training](https://developers.google.com/machine-learning/crash-course/production-ml-systems/static-vs-dynamic-training) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^8]: 📄 [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) — MLflow documentation. Official docs. Checked 2026-11.
[^9]: 🎓 [Production ML systems: Static versus dynamic inference](https://developers.google.com/machine-learning/crash-course/production-ml-systems/static-vs-dynamic-inference) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^10]: 📄 [Deploy models for inference](https://docs.aws.amazon.com/sagemaker/latest/dg/deploy-model.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^11]: 📝 [Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html) — Chip Huyen. Article. Checked 2026-11.
[^12]: 📝 [From Predictive to Generative: How Michelangelo Accelerates Uber's AI Journey](https://www.uber.com/blog/from-predictive-to-generative-ai/) — Uber Engineering. Engineering blog. Checked 2026-11.
[^13]: 📄 [Rules of Machine Learning: Best Practices for ML Engineering](https://developers.google.com/machine-learning/guides/rules-of-ml/) — Martin Zinkevich, Google for Developers. Official docs. Checked 2026-11.
