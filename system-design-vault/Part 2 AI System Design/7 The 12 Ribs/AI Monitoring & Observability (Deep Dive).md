---
aliases: [AI Monitoring & Observability deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[AI Monitoring & Observability]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[AI Monitoring & Observability]] › 🔬 Deep Dive

> [!tldr] For engineers
> ML systems fail **silently**: latency and error rate stay green while prediction quality decays. Production monitoring therefore adds a data plane to classic ops: log a sample of features and predictions, compare their distributions with a **baseline** (training data for skew, past traffic for drift), join predictions with delayed **ground truth** when it arrives, and slice everything. LLM apps add traces of every model and tool call plus online evaluation of sampled outputs.

> [!basics]- New to this? Start with the basics
> [[AI Monitoring & Observability]] explains it with no jargon.

## How it really works

Traditional services expose a binary contract: the request worked or it didn't. A model's contract is statistical, and the world it learned from keeps moving. Sculley et al. put it bluntly: unit and end-to-end tests "are not sufficient" in a changing world, so live monitoring with automated response is "critical for long-term system reliability."[^1]

### What changes, and what to watch

| Shift | What moved | Typical signal |
| --- | --- | --- |
| **Training-serving skew** | Production inputs differ from training inputs, often from a preprocessing or feature bug, usually visible soon after launch[^2] | Distance from the training distribution |
| **Data (input) drift** | Statistical properties of inputs change over time[^2] | Distance from a past window of production traffic |
| **Prediction drift** | The distribution of outputs changes; not always a problem (fraud attempts may really be rising)[^2] | Output histograms, positive rate |
| **Concept drift** | The relationship between inputs and target changes, so old patterns stop holding[^3] | Model quality once labels arrive, or proxies |

Concept drift comes in gradual, sudden and recurring (seasonal) forms; COVID-19 is the textbook sudden case that broke models across industries.[^3]

### The skew/drift pipeline

Managed tools converge on the same loop. Vertex AI Model Monitoring (v1) logs a sample of prediction requests,[^4] builds a baseline distribution per feature, computes the latest distribution, then scores the gap: **L-infinity distance** for categorical features and **Jensen-Shannon divergence** for numerical ones, with TensorFlow Data Validation doing the math.[^5] Each feature has an alert threshold, 0.3 by default.[^5] Skew needs the original training data; drift doesn't.[^4]

SageMaker Model Monitor follows the same shape: capture endpoint inputs and outputs, build a baseline from the training set that **suggests constraints**, then run scheduled jobs that report violations and emit CloudWatch metrics.[^6] It covers data quality, model quality, bias drift and feature-attribution drift.[^6]

A minimal drift check, illustrating the idea:

```python
import numpy as np
from scipy.spatial.distance import jensenshannon

def js_divergence(baseline, live, bins):
    p, _ = np.histogram(baseline, bins=bins)
    q, _ = np.histogram(live, bins=bins)
    # scipy returns the JS *distance* (square root); square it for divergence
    return jensenshannon(p, q, base=2) ** 2

if js_divergence(train["fare"], last_hour["fare"], bins=50) > 0.3:
    alert("fare drifted from training baseline")
```

Other common detectors: Kolmogorov-Smirnov and chi-square tests for small sets of important features, and distance metrics such as Wasserstein or the Population Stability Index for large datasets, where p-values become oversensitive.[^2]

### Closing the loop with ground truth

Drift is a proxy. The direct signal is quality on real outcomes, which often arrive weeks or months late.[^2] Uber's Michelangelo logs and optionally holds back a percentage of predictions, joins them with observed outcomes from the data pipeline, and publishes live accuracy metrics to its time-series monitoring with threshold alerts.[^7]

When labels lag, Google's ML Test Score suggests measuring **prediction bias** on slices (90% of predictions at probability 0.9 should be positive), and having raters label a sample of logged serving inputs.[^8] Sculley et al. add **action limits**: hard caps on real-world actions, such as bids or spam flags, that page a human when hit.[^1]

### Google's seven monitoring tests

The ML Test Score rubric lists 28 tests; seven are about monitoring:[^8]

1. Dependency changes result in notification.
2. Data invariants hold for training and serving inputs (a schema, checked continuously).
3. Training and serving compute the same feature values. Log a sample of serving traffic and compare.
4. Models are not too stale. Track model age through each pipeline stage.
5. Models are numerically stable (alert on NaNs or infinities).
6. No regressions in training speed, serving latency, throughput or RAM.
7. No regression in prediction quality on served data.

### LLM observability

LLM apps rarely have one correct label, and a single answer may involve retrieval, several model calls and tool calls. Two practices dominate:

- **Tracing with GenAI semantics.** OpenTelemetry's GenAI conventions define spans per operation (inference, retrieval, tool execution, agent invocation) with attributes such as `gen_ai.operation.name`, `gen_ai.provider.name` and `gen_ai.request.model`.[^9] Server metrics include `gen_ai.server.time_to_first_token` and `gen_ai.server.time_per_output_token`, both histograms in seconds.[^10] Capturing prompts and outputs is **opt-in** because they "likely" contain sensitive or PII data.[^9] The conventions are still in Development status.[^9]
- **Online evaluation.** Scorers (an LLM judge, human annotation, user feedback or deterministic code checks) attach scores to live traces. Failures found in production are added to the offline test dataset, which grows into a representative regression suite.[^11]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Skew baseline (training data) | Catches pipeline and feature bugs right after launch | Needs the training set; flags expected seasonality as "skew" |
| Drift baseline (recent traffic) | No training data needed; tracks gradual change | Slow drift can shift the baseline with it |
| Statistical tests (KS, chi-square) | p-values, good for a few key features | Oversensitive on large samples[^2] |
| Distance metrics (JS, PSI, Wasserstein) | Scale to many features and big volumes | Thresholds need tuning per feature |
| Static thresholds | Simple, explainable | Noisy on seasonal data |
| Learned thresholds (forecasting) | Handle trend and seasonality | Extra model to operate and trust |
| Logging 100% of requests | Complete replay and debugging | Storage cost and privacy exposure |
| LLM-as-judge online evals | Scales subjective checks | Judge cost and its own errors; needs human spot checks |

## Numbers worth knowing

- **0.3**: Vertex AI's default per-feature alert threshold for skew and drift.[^5]
- **1 hour / 24 hours**: minimum and default monitoring window in Vertex AI v1; without a sampling rate, every request is logged.[^4]
- **75%**: keep disk use below this, or SageMaker Data Capture stops capturing to protect inference.[^6]
- **45 days**: how long a missing fare component in 10% of Uber sessions went unnoticed before manual discovery.[^12]
- **5×**: partial-data incidents at Uber took about five times longer to detect than ETL or infrastructure failures.[^12]
- **>20× to ~2 days**: D3's improvement in mean time to detect; per-dataset compute fell from $1.50 to $0.01 and queries per dataset from 200+ to 8.[^12]
- **7 of 28**: monitoring tests in Google's ML Test Score rubric.[^8]

## Failure modes

- **Healthy servers, broken model.** Dashboards show 200s and low latency while a feature silently arrives null. Defense: data-quality monitors per column (null rate, cardinality, percentiles), not just service metrics.[^12]
- **Training-serving skew.** A feature is computed by one codepath offline and another online. Defense: log serving features and diff them against training values for the same example.[^8]
- **Upstream changes.** Another team's "improvement" to a signal changes its meaning. Defense: subscribe to dependency changes and propagate upstream alerts to the model's control plane.[^8][^1]
- **Masked slice regressions.** Global accuracy rises 1% while one country drops 50%. Defense: slice metrics by country, device or app version.[^8]
- **Alert fatigue.** Hundreds of features each with a threshold produce noise until people stop looking. Defense: monitor the most important features, tune sensitivity, and check data quality before retraining.[^2] Uber lets users tag anomalies as true or false, and a separate diagnosis job switches off alerting on noisy series.[^12]
- **Stale models and stale lookups.** A pipeline stalls and the model or a top-N table stops refreshing. Defense: alert on artifact age.[^8]
- **Feedback loops.** A model influences the data it is later trained on, so drift detectors see the model's own echo.[^1]
- **Observability as a data leak.** Logged prompts and outputs are a new store of user data. Defense: keep content capture opt-in, redact, and restrict access.[^9]

## In the real world

- **Uber D3** profiles 90 days of history once, then runs a daily Spark job per dataset and uses Prophet to predict expected ranges, monitoring dimensions such as city and app version automatically.[^12]
- **Uber Michelangelo** joins logged predictions with outcomes to produce live accuracy metrics.[^7]
- **Google Vertex AI Model Monitoring** offers skew, drift and feature-attribution monitoring with per-feature thresholds.[^5]
- **Amazon SageMaker Model Monitor** offers four monitor types, but is no longer open to new customers.[^6]
- **Langfuse** and similar LLM observability tools store traces and attach scores from judges, humans and code.[^11]

## In a design interview

Separate system health from model health, then answer four questions:

1. **What do you log?** "A 10% sample of requests with features, prediction, model version and request ID; prompts redacted."
2. **Against what baseline?** "Training distribution for skew in week one, a rolling 7-day window for drift."
3. **How do you get ground truth?** "Join on request ID when the label lands; until then, prediction bias and input drift as proxies."
4. **What happens on alert?** "Check data quality first, then roll back or trigger retraining."

Interviewers probe: *labels arrive in 30 days, now what?* (proxies plus human-labeled samples); *which features get alerts?* (top features by importance, sliced); *how do you monitor a chatbot?* (traces, online judges, user feedback, failure cases fed into the eval set).

## 🧱 Builds on

- [[Logging (Deep Dive)]] — structured prediction logs keyed by request ID are what make the later join with ground truth possible.
- [[Metrics (Deep Dive)]] — drift scores, per-slice accuracy and time-to-first-token histograms are ordinary time series with alert rules.
- [[Distributed Tracing (Deep Dive)]] — GenAI spans nest model, retrieval and tool calls under one trace so a bad answer can be explained.

## Check yourself

> [!question]- Why might a drift baseline built from recent production traffic miss a real problem?
> If the shift is slow, the rolling baseline moves with it, so the distance never crosses the threshold. Pair it with a fixed baseline such as the training set, and with quality metrics on labeled samples.

> [!question]- Your fraud model's positive rate doubles overnight. Is the model broken?
> Not necessarily. Prediction drift can be correct if fraud really rose. Check input data quality and upstream changes first, then confirm with labeled outcomes or a reviewed sample.

> [!question]- Why are prompts and completions opt-in in the OpenTelemetry GenAI conventions?
> They are likely to contain sensitive and personal data, so capturing them by default would turn the telemetry pipeline into an unprotected copy of user data.

## Further reading

- 📄 [Introduction to Vertex AI Model Monitoring](https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/overview) — a clear managed implementation of skew and drift scoring.
- 🔬 [The ML Test Score](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) — Google's 28-test rubric, including the seven monitoring tests.
- 📝 [D3: An Automated System to Detect Data Drifts](https://www.uber.com/blog/d3-an-automated-system-to-detect-data-drifts) — an honest incident-driven story with cost numbers.
- 📝 [What is data drift in ML](https://www.evidentlyai.com/ml-in-production/data-drift) — practical tour of detection methods and their pitfalls.
- 📄 [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) — the emerging standard for LLM traces and metrics.

## Related

- [[Evaluation & Metrics (Deep Dive)]] — offline metrics that monitoring tracks online.
- [[MLOps & CI-CD (Deep Dive)]] — drift and performance alerts as retraining triggers.
- [[Data Engineering & Pipelines (Deep Dive)]] — data validation upstream of the model.
- [[Feature Engineering (Deep Dive)]] — feature stores reduce training-serving skew.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — what to do once monitoring fires.

> [!nav] Keep going
> ← [[AI Scalability & Distributed Systems (Deep Dive)|AI Scalability & Distributed Systems]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[MLOps & CI-CD (Deep Dive)|MLOps & CI-CD]] →
> 🌱 Back to the basics: [[AI Monitoring & Observability]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., NeurIPS 2015, section 7. Paper. Checked 2026-11.
[^2]: 📝 [What is data drift in ML, and how to detect and handle it](https://www.evidentlyai.com/ml-in-production/data-drift) — Evidently AI. Article. Checked 2026-11.
[^3]: 📝 [What is concept drift in ML, and how to detect and address it](https://www.evidentlyai.com/ml-in-production/concept-drift) — Evidently AI. Article. Checked 2026-11.
[^4]: 📄 [Monitor feature skew and drift](https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/using-model-monitoring) — Google Cloud. Official docs. Checked 2026-11.
[^5]: 📄 [Introduction to Vertex AI Model Monitoring](https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/overview) — Google Cloud. Official docs. Checked 2026-11.
[^6]: 📄 [Data and model quality monitoring with Amazon SageMaker Model Monitor](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^7]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^8]: 🔬 [The ML Test Score: A Rubric for ML Production Readiness and Technical Debt Reduction (PDF)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — Breck et al., IEEE Big Data 2017. Paper. Checked 2026-11.
[^9]: 📄 [Semantic conventions for generative AI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) — OpenTelemetry. Standard. Checked 2026-11.
[^10]: 📄 [Semantic conventions for generative AI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) — OpenTelemetry. Standard. Checked 2026-11.
[^11]: 📄 [Evaluation core concepts](https://langfuse.com/docs/evaluation/core-concepts) — Langfuse documentation. Official docs. Checked 2026-11.
[^12]: 📝 [D3: An Automated System to Detect Data Drifts](https://www.uber.com/blog/d3-an-automated-system-to-detect-data-drifts) — Uber Engineering, 2023. Engineering blog. Checked 2026-11.
