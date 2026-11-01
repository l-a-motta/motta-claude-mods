---
aliases: [MLOps & CI-CD deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[MLOps & CI-CD]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[MLOps & CI-CD]] › 🔬 Deep Dive

> [!tldr] For engineers
> MLOps extends CI/CD along three axes of change (code, data and model) and adds **continuous training**. The deployable unit shifts from a model file to a **training pipeline** that validates data, trains, validates the model against production, registers it with lineage, and releases it behind canary or shadow traffic with fast rollback. For LLM apps the same loop versions prompts and gates them on evaluation pass rates.

> [!basics]- New to this? Start with the basics
> [[MLOps & CI-CD]] explains it with no jargon.

## How it really works

Sculley et al.'s famous figure shows the ML code as a small black box inside a much larger system of configuration, data collection, verification, feature extraction, serving and monitoring.[^1] MLOps is the engineering of that surrounding system. Google's definition: unify ML development and operations by automating and monitoring every step of building the system.[^2]

### How ML CI/CD differs from DevOps

Google's architecture guide names three differences:[^2]

- **CI** tests and validates data, data schemas and models, not only code.
- **CD** delivers a *system* (a training pipeline that in turn deploys a prediction service), not a single package.
- **CT** (continuous training) is new: the pipeline retrains and serves models automatically.

CD4ML frames the same idea as three axes, "the code itself, the model, and the data", each versioned and flowing through one delivery process.[^3] Data versioning tools such as DVC commit a checksum file to Git, so a data change can trigger a pipeline run the way a code commit does.[^3]

### Maturity levels

| Level | What is automated | Typical pain |
| --- | --- | --- |
| **0: Manual** | Nothing. Notebook training, a model artifact handed to engineers, releases a couple of times a year, little monitoring[^2] | Models decay unnoticed; no reproducibility |
| **1: Pipeline automation** | The training pipeline runs automatically (CT), with data and model validation, a metadata store and an optional feature store; the same pipeline runs in dev and prod[^2] | Pipeline changes themselves are still tested and deployed by hand |
| **2: CI/CD of pipelines** | Building, testing and deploying pipeline components, plus a model registry and an orchestrator[^2] | Data and model analysis remain manual |

### The pipeline, step by step

1. **Data validation.** Before training, check for **schema skew** (missing, unexpected or wrongly typed features), which should halt the pipeline, and **value skew** (significant distribution shifts), which should trigger retraining.[^2]
2. **Training** with every parameter, code version and artifact location written to an **ML metadata store**, giving lineage and a pointer for rollback.[^2]
3. **Model validation.** Evaluate on a test set, compare with the current production model, check consistency across data segments, and confirm compatibility with the serving infrastructure and API. Promote only if better.[^2]
4. **Registration.** Store the version with its lineage to the producing run.[^4]
5. **Online validation** via canary deployment or A/B test.[^2]

A slice-aware validation gate, in pseudocode, following the ML Test Score's advice to bound both absolute and incremental slice error:[^5]

```python
def promote(new, prod, slices):
    if new.metric("auc") < prod.metric("auc"):
        return False
    for s in slices:                      # country, device, language...
        if new.error(s) > 0.05:           # absolute bound
            return False
        if new.error(s) - prod.error(s) > 0.01:  # regression bound
            return False
    return True
```

### What CI should test

Google's list: unit tests for feature-engineering logic and model methods, a check that loss decreases (overfit a few records), no NaNs, each component produces its expected artifacts, and integration tests between components.[^2] The ML Test Score adds infrastructure tests: training is reproducible, the full pipeline is integration-tested, models are validated before serving, canaried before serving, and can be rolled back quickly.[^5]

### Registry and promotion

The MLflow Model Registry stores registered models with incrementing versions, tags, lineage to the producing run, and **aliases**: mutable named pointers to a version.[^4] Serving code loads by alias, so promotion and rollback are a pointer move:[^4]

```python
import mlflow
model = mlflow.pyfunc.load_model("models:/fraud-detector@champion")
# promote: reassign "champion" to the new version; roll back: point it at the old one
```

Uber's Michelangelo used the same idea in 2017: models were versioned objects identified by UUID plus an optional tag or alias, so clients could switch models without code changes and run several at once for A/B tests.[^6]

### Release strategies

CD4ML lists **shadow** models (receive production traffic alongside the live model before promotion), **competing** models (A/B tests or multi-armed bandits), multiple models behind one interface, and online learning.[^3] SageMaker's deployment guardrails implement blue/green updates in three modes, all at once, **canary** (a small slice, then the rest) and **linear** (equal steps), each with a **baking period** during which any tripped CloudWatch alarm rolls 100% of traffic back to the old fleet.[^7]

### LLMOps

For LLM apps the "model" may not change at all; the prompt does. MLflow's prompt registry versions prompts with commit messages, evaluates each version on the same dataset with built-in and custom judges, and aggregates boolean judgments into a **pass rate** to compare versions, then promotes through aliases.[^8] The feature is in Beta on Databricks.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Deploy the model artifact (level 0) | Simple | No CT; drift goes unaddressed |
| Deploy the training pipeline (level 1+) | Retrains automatically; dev and prod identical | Pipeline is now production code to test |
| Retrain on a schedule | Predictable cost and cadence | May retrain needlessly or too late |
| Retrain on drift or degradation | Reacts to real change | Needs trustworthy monitoring; risk of training on broken data |
| Shadow deployment | Zero user impact; real inputs | Doubles inference cost; no outcome feedback for the new model |
| Canary | Small blast radius | Two fleets run in parallel for the whole rollout[^7] |
| Linear rollout | Lowest risk per step | Duration and cost grow with the number of steps[^7] |
| Embedded model vs separate service | No network hop | Redeploy the app to change the model[^3] |

## Numbers worth knowing

- **28 tests in 4 sections** (data, model, infrastructure, monitoring) make up the ML Test Score; half a point for a manual test, a full point for automated, and the final score is the **minimum** across sections.[^5]
- **36 teams** were scored at Google, and **none** of the tests was implemented by more than 80% of teams surveyed.[^5]
- **1–2 months** from feature idea to production is achievable for highly efficient teams, even on global-scale systems, per the same rubric.[^5]
- **Thousands of models** across hundreds of use cases ran on Uber's Michelangelo in 2018, serving millions of predictions per second.[^9]
- **A couple of times a year**: typical release cadence at MLOps level 0.[^2]
- **Both fleets billed**: SageMaker charges for blue and green fleets during multi-step or baked rollouts.[^7]

## Failure modes

- **Training-serving skew.** Features computed differently offline and online. Defense: shared feature code or a feature store, plus skew monitoring.[^2][^5]
- **Model/server mismatch.** A model trained with a newer library op fails to load on older serving binaries. Defense: canary that the model loads and serves real inputs before rollout.[^5]
- **Non-reproducible training.** Random seeds, initialization order and distributed data ordering make retraining non-deterministic, which breaks diff-testing of refactors.[^5]
- **Untested rollback.** Rollback is an emergency procedure, so practice it in normal conditions.[^5]
- **Configuration debt.** In mature systems configuration lines can outnumber code lines; configs need review and version control like code.[^1]
- **Dead experimental codepaths.** Sculley et al. cite Knight Capital losing $465 million in 45 minutes, apparently from obsolete experimental code.[^1]
- **Retraining on bad data.** CT faithfully learns from a broken feed. Defense: data validation that halts the pipeline on schema anomalies.[^2]

## In the real world

- **Uber Michelangelo** (2017) covered managing data, training, evaluating, deploying, predicting and monitoring; models were zipped and shipped with Uber's standard code deployment infrastructure.[^6] By 2018 it served any Python model through PyML, and every model was version-controlled and reproducible.[^9]
- **Google** published both the MLOps maturity model and the ML Test Score from internal experience.[^2][^5]
- **Thoughtworks' CD4ML** shows an open-source stack: DVC for data, MLflow for experiment tracking, and existing logging infrastructure for monitoring.[^3]
- **Amazon SageMaker** ships canary and linear rollouts with alarm-driven auto-rollback.[^7]

## In a design interview

Frame it as a loop, then fill each box:

1. **Trigger:** "Retrain nightly, plus on drift alerts from monitoring."
2. **Validate data:** "Schema anomalies stop the run; distribution shifts are logged."
3. **Validate model:** "Beat production on AUC with no slice regressing more than 1 point."
4. **Register:** "Version with lineage; serving reads the `champion` alias."
5. **Release:** "Shadow for a day, then 5% canary with latency and error alarms, then linear to 100%."
6. **Roll back:** "Move the alias back; practiced monthly."

Interviewers probe: *how do you know offline gains translate online?* (A/B tests; offline and online metrics correlation is itself a test);[^5] *what if labels are delayed?* (shadow plus proxies); *how do you version data?* (snapshots or checksums committed with code).

## 🧱 Builds on

- [[Microservices (Deep Dive)]] — the model ships as an independently deployable service, with its own API contract that model validation must check.
- [[Fault Tolerance (Deep Dive)]] — blue/green fleets, baking periods and alarm-triggered rollback are classic redundancy and fail-fast patterns applied to models.

## Check yourself

> [!question]- Why does Google say CD in ML deploys a system rather than a package?
> At level 1 and above you deploy the training pipeline, which itself produces and deploys models. Testing the pipeline is what makes continuous training safe.

> [!question]- Why does the ML Test Score take the minimum across sections instead of the sum?
> All four areas matter. A team cannot compensate for missing monitoring with extra data tests, so the weakest area caps the score.

> [!question]- When would you choose shadow deployment over a canary?
> When any user-visible regression is unacceptable or outcomes are hard to measure quickly. Shadow tests the new model on real inputs at zero user impact, at the cost of double inference and no feedback on its decisions.

## Further reading

- 📄 [MLOps: Continuous delivery and automation pipelines in ML](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — the maturity model everyone quotes.
- 📝 [Continuous Delivery for Machine Learning](https://www.martinfowler.com/articles/cd4ml.html) — an end-to-end walkthrough with open-source tools.
- 🔬 [The ML Test Score](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) — a checklist you can score your own system against.
- 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — why ML systems rot without this discipline.
- 📄 [Blue/Green Deployments](https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails-blue-green.html) — concise comparison of rollout modes.

## Related

- [[AI Monitoring & Observability (Deep Dive)]] — the signals that trigger continuous training.
- [[Deployment & Serving (Deep Dive)]] — serving infrastructure the pipeline deploys to.
- [[Model Selection & Training (Deep Dive)]] — what runs inside the training step.
- [[Feature Engineering (Deep Dive)]] — feature stores and shared transforms.
- [[Evaluation & Metrics (Deep Dive)]] — the metrics behind the validation gate.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — fallbacks when a release goes wrong.

> [!nav] Keep going
> ← [[AI Monitoring & Observability (Deep Dive)|AI Monitoring & Observability]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[AI Security & Privacy (Deep Dive)|AI Security & Privacy]] →
> 🌱 Back to the basics: [[MLOps & CI-CD]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., NeurIPS 2015. Paper. Checked 2026-11.
[^2]: 📄 [MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — Google Cloud Architecture Center. Official docs. Checked 2026-11.
[^3]: 📝 [Continuous Delivery for Machine Learning](https://www.martinfowler.com/articles/cd4ml.html) — Danilo Sato et al., martinfowler.com. Article. Checked 2026-11.
[^4]: 📄 [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry) — MLflow documentation. Official docs. Checked 2026-11.
[^5]: 🔬 [The ML Test Score: A Rubric for ML Production Readiness and Technical Debt Reduction (PDF)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/aad9f93b86b7addfea4c419b9100c6cdd26cacea.pdf) — Breck et al., IEEE Big Data 2017. Paper. Checked 2026-11.
[^6]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^7]: 📄 [Blue/Green Deployments](https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails-blue-green.html) — Amazon SageMaker AI Developer Guide. Official docs. Checked 2026-11.
[^8]: 📄 [Evaluate and compare prompt versions](https://docs.databricks.com/aws/mlflow3/genai/prompt-version-mgmt/prompt-registry/evaluate-prompts) — Databricks documentation. Official docs. Checked 2026-11.
[^9]: 📝 [Scaling Machine Learning at Uber with Michelangelo](https://www.uber.com/blog/scaling-michelangelo/) — Uber Engineering, 2018. Engineering blog. Checked 2026-11.
