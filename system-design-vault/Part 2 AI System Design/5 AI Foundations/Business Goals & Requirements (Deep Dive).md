---
aliases: [Business Goals & Requirements deep dive]
tags: [level/deep-dive, part/2, section/ai-foundations]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Foundations]]"
basics: "[[Business Goals & Requirements]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Foundations]] › [[Business Goals & Requirements]] › 🔬 Deep Dive

> [!tldr] For engineers
> AI requirements add a layer ordinary software lacks: a **metric ladder** from business KPI to product proxy to model objective, an explicit **error-cost model**, and latency, freshness and cost budgets per prediction. The first decision is whether ML is needed at all. The usual failures are a proxy that drifts away from the goal, value nobody can measure, and features that don't exist at prediction time.

> [!basics]- New to this? Start with the basics
> [[Business Goals & Requirements]] explains it with no jargon.

## How it really works

### From business question to ML task

AWS's Machine Learning Lens calls business goal identification "the most important phase of the ML lifecycle" and lists its work steps.[^1] Paraphrased:

- **Business:** understand requirements, align stakeholders, form a business question, identify must-have features, and decide how business value will be measured.[^1]
- **Framing:** define the ML task from the business question, review published work in similar domains, and run small, focused proofs of concept where confidence is low.[^1]
- **Cost:** evaluate the cost of data acquisition, training, inference **and wrong predictions**.[^1]
- **Production:** decide how to handle ML-generated errors and establish a path to production before building.[^1]

The next phase, ML problem framing, makes the link explicit. Define the relationship between the technical metric and the business outcome, get stakeholders to agree on it, and formulate the task as inputs, outputs and a metric to optimize.[^2] It also says to evaluate whether ML is the right approach at all, because "simple business rules can do a much better job" for some problems.[^2]

### The metric ladder

Google's problem-framing course separates three things: the **ideal outcome** (what the product should do), the **model's goal** (what the model predicts), and **success metrics** (what the business measures).[^3] It stresses that success metrics "differ from the model's evaluation metrics" such as precision, recall or AUC.[^3] When the true target has no label, you pick a proxy: for "recommend useful videos," the label becomes "shared OR liked."[^3]

Write the ladder down for every AI feature:

```text
Business KPI      net bookings per visitor        slow, noisy, what leadership cares about
Product metric    booking rate on recommended     faster, attributable to the feature
Model objective   log loss on "booked in session" what training optimizes
Guardrails        p95 latency, cost per request,  must not regress, even if the KPI rises
                  complaint rate
```

Rules of ML gives the selection criteria. The first objective should be "simple, observable and attributable," and "a proxy for the 'true' objective."[^4] It also warns that "launch decisions are a proxy for long-term product goals": the only easy launches are those where no metric gets worse.[^4]

The ladder can break. Booking.com reports that "increasing the performance of a model does not necessarily translate into a gain in" business value. Causes include value saturation and over-optimizing proxies such as clicks.[^5]

### Error costs and thresholds

Most product decisions hide a classification threshold. Google's People + AI Guidebook warns not to weigh false positives and false negatives equally by default, and frames the choice as **precision** (fewer irrelevant results, more misses) versus **recall** (fewer misses, more noise).[^6] It recommends designing this "reward function" jointly with UX, product and engineering, and asking what happens to users if it is perfectly optimized.[^6]

Once stakeholders price the two errors, the threshold is arithmetic:

```python
def pick_threshold(scores, labels, cost_fp, cost_fn):
    best = None
    for t in sorted(set(scores)):
        fp = sum(s >= t and not y for s, y in zip(scores, labels))
        fn = sum(s < t and y for s, y in zip(scores, labels))
        cost = cost_fp * fp + cost_fn * fn
        if best is None or cost < best[1]:
            best = (t, cost)
    return best  # (threshold, expected cost on this validation set)
```

The same guide asks whether to **automate or augment**. Automate tasks people find boring or dangerous and agree on how to do. Augment when people enjoy the task, carry responsibility, or the stakes are high.[^6]

### Non-functional requirements specific to AI

- **Latency.** Booking.com measured that ~30% more latency cost ~0.5% conversion.[^5] Uber's online serving reached P95 under 5 ms for models without Cassandra-backed features.[^7]
- **Freshness.** "How much does performance degrade if you have a model that is a day old?"[^4] The answer sets retraining cadence.
- **Feature availability.** Inputs must exist at prediction time in the right format; features that are hard to get then should be dropped.[^8]
- **Cost per prediction.** For LLM features, budget per call, model size and call frequency.[^9]
- **Privacy.** Whether the system follows instructions not to use or share certain details is a success criterion of its own.[^9]

### Success criteria for LLM features

Anthropic's evaluation guide asks for criteria that are **specific, measurable, achievable and relevant**, and shows that "safe outputs" is not a requirement while a toxicity rate over 10,000 trials is.[^9] Most features need several criteria at once:[^9]

```yaml
feature: support-ticket sentiment
eval_set: 10,000 held-out posts
criteria:
  f1: ">= 0.85"                # 5% over current baseline
  non_toxic_outputs: ">= 99.5%"
  p95_latency_ms: "< 200"
  severe_errors: "<= 10% of errors"   # define 'severe' explicitly
```

### Is ML needed at all?

Google calls ML "a specialized tool suitable only for particular problems": optimize a non-ML solution first, and remember that "ML implementations need dedicated long-term maintenance."[^8] AWS's sustainability guidance adds: "Always ask if AI/ML is right for your workload," and prefer managed AI services or pre-trained models over training your own.[^10] For LLM applications, Anthropic's rule is the simplest solution possible, adding complexity only when needed.[^11]

## Design choices and trade-offs

| Decision | Option A | Option B | Lean toward B when |
| --- | --- | --- | --- |
| Approach | Rules or heuristic | ML model | Rules grow complex and unmaintainable[^4] |
| Build | Pre-trained model or managed service | Train your own | No managed service or pre-trained model fits the need[^10] |
| Role | Augment a human | Automate fully | Task is tedious, low-stakes and agreed on[^6] |
| Error bias | High precision | High recall | Misses cost more than false alarms[^6] |
| Objective | Simple, attributable proxy | Composite long-term KPI | The proxy is saturated or gamed[^4][^5] |
| LLM control | Fixed workflow | Agent | The task is open-ended and worth the cost[^11] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Booking.com production models analyzed | ~150, validated with randomized controlled trials[^5] |
| Booking.com latency cost | ~30% more latency ≈ 0.5% lower conversion[^5] |
| Uber online serving P95 | < 5 ms; < 10 ms with Cassandra features[^7] |
| Uber highest-traffic models (2017) | > 250,000 predictions per second[^7] |
| Example action threshold (PAIR) | Rejection rate above 20% → check the model[^6] |
| Example LLM criteria (Anthropic) | F1 ≥ 0.85; 99.5% non-toxic; 95% of responses < 200 ms[^9] |

The last two are illustrations from their guides, not industry standards. Their value is the shape: metric, threshold, action.

## Failure modes

- **Proxy drift.** The model optimizes clicks while bookings stay flat. Defense: tie every launch to an online experiment on the business KPI.[^5]
- **Unmeasurable value.** No one can say what success is worth. AWS insists value be measurable against specific objectives before work starts.[^1]
- **Training-only features.** A feature exists in the warehouse but not at request time. Defense: check availability during framing.[^8]
- **Symmetric error assumption.** Default thresholds treat a missed fraud and a false block the same. Defense: price both with stakeholders.[^6]
- **Proof of concept that never ships.** Siloed handoffs leave models stuck at proof-of-concept or stale once deployed.[^12] Defense: plan the path to production in the goal phase.[^1]
- **Second-order effects.** The metric is hit while users or society pay. Defense: ask what perfect optimization would do.[^6]
- **Over-engineering.** An agent where one prompt would do. Defense: start simple.[^11]

## In the real world

- **Booking.com** runs randomized trials with extra control groups. One group never invokes the model, isolating its latency cost; candidates are compared only where they disagree with the incumbent.[^5] Its overall lesson is an "iterative, hypothesis driven process."[^13]
- **Google** teaches the "shared OR liked" proxy for video usefulness as the canonical framing example.[^3]
- **Uber** framed UberEATS delivery time as a regression problem covering everything from order placement through preparation and pickup to the customer's door, served online through Michelangelo.[^7]
- **Anthropic** publishes success-criteria templates for LLM features covering fidelity, consistency, tone, privacy, latency and price.[^9]

## In a design interview

Spend the first five minutes here; it is what separates senior answers.

1. **Restate the goal** in business terms and name the stakeholders.
2. **Metric ladder:** KPI, online proxy, offline metric, guardrails.
3. **Baseline:** "What does a heuristic get us?"
4. **Constraints:** QPS and latency budget (estimate them), cost per prediction, freshness, privacy.
5. **Error costs:** which mistake is worse; precision or recall bias.
6. **Launch criteria:** what must improve, what must not regress, and the rollback trigger.

Interviewers probe: *Your offline metric improved but revenue didn't; why?* *What if labels arrive a week late?* *Who decides the threshold?*

## 🧱 Builds on

- [[Requirements]] — functional and non-functional requirements, extended with a metric ladder and error-cost targets.
- [[Estimation]] — QPS × cost per prediction gives the inference bill; latency budgets bound model size.
- [[Trade-offs]] — precision versus recall, freshness versus cost, automation versus control.

## Check yourself

> [!question]- Your model's AUC rose 3% offline but the A/B test shows no change in bookings. Name three possible causes.
> The proxy has saturated (gains land where there's no value left), the improvement is in segments that don't convert, or the model got slower and the latency cost cancelled the gain. Booking.com reports all of these patterns.

> [!question]- Why make the first objective "simple, observable and attributable"?
> Because you need to tell quickly whether a change helped and why. A composite or delayed KPI hides cause and effect, so iteration stalls.

> [!question]- When should a fraud system favor recall over precision?
> When a missed fraud costs far more than a false block and you have a cheap way to recover from false blocks, like a quick verification step.

## Further reading

- 📄 [Business goal identification](https://docs.aws.amazon.com/wellarchitected/latest/machine-learning-lens/business-goal-identification.html) — a concrete checklist for the phase most teams skip.
- 🎓 [Framing an ML problem](https://developers.google.com/machine-learning/problem-framing/ml-framing) — ideal outcome, model goal and proxy labels with worked examples.
- 📄 [User Needs + Defining Success](https://pair.withgoogle.com/chapter/user-needs/) — the best treatment of error costs and automation versus augmentation.
- 📝 [150 successful ML models at Booking.com](https://blog.acolyer.org/2019/10/07/150-successful-machine-learning-models/) — why model metrics and business metrics diverge.
- 📄 [Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests) — measurable criteria for LLM features, then evals that check them.

## Related

- [[AI System Design Overview (Deep Dive)]] — where requirements sit in the lifecycle.
- [[Evaluation & Metrics (Deep Dive)]] — offline and online metrics in depth.
- [[Cost Optimization (Deep Dive)]] — keeping cost per prediction in budget.
- [[Ethics & Governance (Deep Dive)]] — second-order effects and accountability.
- [[Requirements (Deep Dive)]] — the Part 1 foundations.

> [!nav] Keep going
> ← [[AI System Design Overview (Deep Dive)|AI System Design Overview]] · [[AI Foundations|🎯 AI Foundations]] · [[AI Architecture Layers (Deep Dive)|AI Architecture Layers]] →
> 🌱 Back to the basics: [[Business Goals & Requirements]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Business goal identification](https://docs.aws.amazon.com/wellarchitected/latest/machine-learning-lens/business-goal-identification.html) — AWS Well-Architected Machine Learning Lens. Official docs. Checked 2026-11.
[^2]: 📄 [ML problem framing](https://docs.aws.amazon.com/wellarchitected/latest/machine-learning-lens/ml-problem-framing.html) — AWS Well-Architected Machine Learning Lens. Official docs. Checked 2026-11.
[^3]: 🎓 [Framing an ML problem](https://developers.google.com/machine-learning/problem-framing/ml-framing) — Google for Developers, Introduction to ML Problem Framing. Course. Checked 2026-11.
[^4]: 📄 [Rules of Machine Learning: Best Practices for ML Engineering](https://developers.google.com/machine-learning/guides/rules-of-ml/) — Martin Zinkevich, Google for Developers. Official docs. Checked 2026-11.
[^5]: 📝 [150 successful machine learning models: 6 lessons learned at Booking.com](https://blog.acolyer.org/2019/10/07/150-successful-machine-learning-models/) — Adrian Colyer, The Morning Paper, summarizing Bernardi et al., KDD 2019. Article. Checked 2026-11.
[^6]: 📄 [User Needs + Defining Success](https://pair.withgoogle.com/chapter/user-needs/) — Google PAIR, People + AI Guidebook. Official guide. Checked 2026-11.
[^7]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/en-AU/blog/michelangelo-machine-learning-platform/) — Uber Engineering. Engineering blog. Checked 2026-11.
[^8]: 🎓 [Understand the problem](https://developers.google.com/machine-learning/problem-framing/problem) — Google for Developers, Introduction to ML Problem Framing. Course. Checked 2026-11.
[^9]: 📄 [Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests) — Anthropic, Claude Docs. Official docs. Checked 2026-11.
[^10]: 📝 [Optimize AI/ML workloads for sustainability, Part 1](https://aws.amazon.com/blogs/architecture/optimize-ai-ml-workloads-for-sustainability-part-1-identify-business-goals-validate-ml-use-and-process-data) — AWS Architecture Blog. Engineering blog. Checked 2026-11.
[^11]: 📝 [Building effective agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024. Engineering blog. Checked 2026-11.
[^12]: 📝 [Continuous Delivery for Machine Learning](https://martinfowler.com/articles/cd4ml.html) — Sato, Wider and Windheuser, martinfowler.com. Article. Checked 2026-11.
[^13]: 🔬 [150 Successful Machine Learning Models: 6 Lessons Learned at Booking.com](https://www.kdd.org/kdd2019/accepted-papers/view/150-successful-machine-learning-models-6-lessons-learned-at-booking.com) — Bernardi, Mavridis and Estevez, KDD 2019. Paper. Checked 2026-11.
