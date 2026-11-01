---
aliases: [Evaluation & Metrics deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Evaluation & Metrics]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Evaluation & Metrics]] › 🔬 Deep Dive

> [!tldr] For engineers
> Evaluation runs in two loops: **offline** against held-out data with a task metric chosen from the cost of each error type, and **online** with randomized experiments against product metrics. Offline metrics are proxies, and so are most online ones. For LLMs and agents the output is open-ended and non-deterministic, so suites mix code graders, model judges calibrated against humans and human review, with several trials per task.

> [!basics]- New to this? Start with the basics
> [[Evaluation & Metrics]] explains it with no jargon.

## How it really works

### Classification metrics and the threshold

A binary classifier emits a score; a **threshold** turns it into a label, and every prediction lands in one cell of the confusion matrix (TP, FP, TN, FN). The standard metrics are ratios of those cells:[^1]

```text
accuracy  = (TP + TN) / (TP + TN + FP + FN)
precision = TP / (TP + FP)
recall    = TP / (TP + FN)          # true positive rate
FPR       = FP / (FP + TN)          # false positive rate
F1        = 2 * precision * recall / (precision + recall)
```

All of them are computed **at one threshold**. Raising it usually cuts false positives and adds false negatives, so precision and recall tend to move in opposite directions.[^1] Pick the metric from the cost structure: recall when false negatives are expensive, FPR when false positives are, precision when positive predictions must be right, F1 for imbalanced data. Accuracy is only a coarse signal on balanced data: with a 1% positive class, always predicting negative scores about 99%.[^1]

### Splits, leakage and test-set wear

Data is split into **training** (fit), **validation** (tune hyperparameters and features) and **test** (final check).[^2] Two traps dominate:

- **Duplicates across splits.** Google's crash course describes a spam model that showed 99% precision on both the training and the test set because many test emails were duplicates of training emails.[^2] Deduplicate before splitting.
- **Wear.** Each decision made by looking at the validation or test set fits the model a little more to that set. The more a set informs decisions, the less it predicts performance on new data, so refresh it with new examples.[^2]

### From offline to online

Offline numbers do not launch a model. Google Cloud's MLOps reference architecture has a new model go through **A/B testing or a canary deployment** before it serves all traffic, and treats monitoring of live predictive performance as the trigger for the next training cycle.[^3]

Google's *Rules of Machine Learning* explain why. The ML objective should be "a proxy for the 'true' objective" (Rule #13), and even metrics measurable in A/B tests are only proxies for long-term product goals (Rule #39).[^4] Rule #2 asks for an experiment framework that buckets users and aggregates statistics per experiment before any ML ships.[^4] Rule #37 separates gaps between training and holdout data, which always exist, from gaps between next-day and live data, which usually mean an engineering bug.[^4]

### Online controlled experiments

An A/B test randomly assigns users to control and treatment and compares metrics. At scale it becomes infrastructure. Bing reported over 200 concurrent experiments on any given day in 2013, each potentially reaching millions of users, and estimated that a 1% revenue gain was worth about $10M a year in the US alone.[^5] The same paper reports a high rate of false positives that has to be actively managed, statistical interactions between concurrent experiments, and alerting as the main safety net, since classical debugging cannot cover millions of live variant combinations.[^5]

Keep canaries and A/B tests separate. A **canary** checks for regressions and finishes in minutes or hours; an A/B test checks a hypothesis and can take days to reach significance. Mixing the two can skew results.[^6]

### Evaluating LLMs and agents

Anthropic's agent-eval guide gives a useful vocabulary: a **task** has inputs and success criteria; a **trial** is one attempt; a **grader** scores some aspect; the **transcript** is the full record of tool calls and reasoning; the **outcome** is the end state of the environment.[^7] Because outputs vary from run to run, a task is run several times, and two aggregates answer different questions:[^7]

```python
p = 0.75                  # per-trial success rate
pass_at_k  = 1 - (1 - p) ** 3   # at least one of 3 succeeds -> ~0.98
pass_hat_k = p ** 3             # all 3 succeed              -> ~0.42
```

Use pass@k when one good answer is enough (a human picks the best); use pass^k when the agent must be reliable every time.[^7] **Capability evals** should start with a low pass rate and give the team a hill to climb; **regression evals** should sit near 100%, and capability tasks graduate into the regression suite once solved.[^7]

**LLM-as-a-judge.** A strong model grades outputs against a rubric or compares two answers pairwise. Zheng et al. found GPT-4 judges agree with human preferences over 80% of the time, the same level humans reach with each other, but documented **position**, **verbosity** and **self-enhancement** biases plus limited reasoning ability.[^8] Anthropic's advice is to calibrate model graders closely against human experts.[^7]

**Pairwise human preference at scale.** Chatbot Arena shows two anonymous models the same user prompt, collects a vote, and fits **Bradley-Terry** coefficients to the win/loss data, which the authors prefer to online Elo for statistical estimation.[^9] The motivation is that static benchmarks become contaminated and saturated over time.[^9]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Accuracy | One intuitive number | Misleading on imbalanced classes |
| Precision / recall at a chosen threshold | Ties the metric to error costs | Needs a business decision on the threshold |
| F1 | Single number that balances both | Hides which error type dominates |
| Code-based graders | Fast, cheap, reproducible[^7] | Brittle to valid variations; weak on subjective tasks[^7] |
| Model-based graders (LLM judge) | Scales; handles open-ended output[^7] | Non-deterministic, biased, needs calibration[^8] |
| Human graders | Gold standard[^7] | Slow and expensive[^7] |
| Grade outcomes | Allows valid unexpected paths[^7] | Needs an inspectable end state |
| Grade exact steps | Easy to write | Brittle; punishes better solutions[^7] |
| Offline eval only | Cheap, fast iteration | Proxy; misses real user behavior[^4] |
| Online A/B test | Measures causal effect on users | Needs traffic and time; risk to real users |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Accuracy of "always negative" with a 1% positive class | About 99%[^1] |
| GPT-4 judge agreement with human preferences | Over 80%, same as human-human[^8] |
| Chatbot Arena scale (January 2024) | About 240K votes, over 90K users, 50+ models[^9] |
| Released MT-bench / Arena data | 3K expert votes, 30K conversations[^8] |
| Bing concurrent experiments (2013) | Over 200 per day[^5] |
| Value of a 1% revenue gain at Bing | About $10M per year (US)[^5] |
| Suggested starting agent eval suite | 20 to 50 tasks from real failures[^7] |
| pass^3 at 75% per-trial success | About 42%[^7] |
| SWE-bench Verified, one year of progress | About 40% to over 80%[^7] |
| CORE-Bench score after fixing grading bugs | 42% to 95%[^7] |

## Failure modes

- **Leakage.** Duplicates or near-duplicates across splits inflate scores; the spam example reached 99% precision this way.[^2] Deduplicate, split by time or by user.
- **Overfitting the test set.** Repeated tuning against the same set erodes its value.[^2] Hold a final test set back and refresh sets periodically.
- **Proxy drift.** The optimized metric rises but the launch is rejected; per Rule #12 that signals the objective needs revising.[^4]
- **Training-serving skew.** Features computed differently online than offline make offline wins vanish; log serving-time features and train on them (Rule #29).[^4]
- **Broken tasks and graders.** A 0% pass rate across many trials usually means the task is broken, not the agent; CORE-Bench jumped from 42% to 95% once grading bugs were fixed.[^7]
- **Judge bias.** Position and verbosity bias skew pairwise judgments.[^8] Swap answer order and average, and spot-check against humans.
- **Saturation and contamination.** A suite at 100% gives no signal for improvement, and public benchmarks leak into training data.[^7][^9]
- **False positives in experiments.** Large experiment programs see many spurious wins and cross-experiment interactions.[^5]

## In the real world

- **Bing** runs experimentation as a platform, crediting it with hundreds of millions of dollars in annual revenue gains and with catching harmful features before they shipped.[^5]
- **Uber Michelangelo** logs live predictions, joins them later with observed outcomes, and publishes live accuracy metrics (R², RMSE, MAE and others) to time-series monitoring with alert thresholds.[^10]
- **Anthropic's Claude Code** began with feedback-driven iteration, then added evals for narrow behaviors such as concision and file edits, and later for over-engineering.[^7]
- **Chatbot Arena** turned crowdsourced pairwise votes into a public LLM leaderboard;[^9] it became a company and, since January 2026, operates simply as Arena.[^11]

## In a design interview

Interviewers want to hear that "accuracy" is never the full answer. Skeleton:

1. **Define success from the requirement.** "Fraud: a missed fraud costs about 100 times a false block, so optimize recall at a precision floor of 0.8."
2. **Offline.** Time-based split, deduplicated; report precision, recall and PR curves per segment.
3. **Online.** Shadow first, then a canary for health, then an A/B test on the business metric with guardrail metrics such as latency and complaint rate.
4. **After launch.** Log predictions, join with delayed labels, alert on drops.
5. **For an LLM feature.** Golden set of 20 to 50 real cases, code checks where possible, an LLM judge calibrated against human labels, several trials per task.

Probes: *How do you pick the threshold?* (From error costs.) *Labels arrive weeks later?* (Proxy metrics now, true metrics later.) *Can you trust the judge?* (Measure its agreement with humans; randomize order.)

## 🧱 Builds on

- [[Metrics (Deep Dive)]] — live model quality becomes another time series with thresholds and alerts, exactly like latency and error-rate metrics.[^10]
- [[Requirements (Deep Dive)]] — functional and non-functional requirements become measurable acceptance criteria: a recall floor, a latency budget, a guardrail metric that must not regress.

## Check yourself

> [!question]- Your fraud model's F1 went up but the business rejected the launch. How can both be true?
> F1 weights precision and recall equally, while the business cost does not. The new model may trade recall for precision. Evaluate at the operating threshold with a cost-weighted metric instead.

> [!question]- An agent passes a task 75% of the time. Is it production-ready?
> Depends on the use. pass@3 is about 98%, fine if a human picks the best of three. pass^3 is about 42%, poor if the agent must succeed every time unattended.

> [!question]- Why not run the canary and the A/B test as one experiment?
> They answer different questions on different timescales: a canary catches regressions in minutes, an A/B test needs days for significance. Merging them skews the experiment's results.

## Further reading

- 🎓 [Classification: Accuracy, recall, precision, and related metrics](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall) — the clearest short treatment of thresholds and metric choice.
- 📝 [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — practical vocabulary and process for agent evals, from a lab that ships them.
- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — hard-won rules on objectives, proxies and training-serving skew.
- 🔬 [Online Controlled Experiments at Large Scale](https://exp-platform.com/large-scale/) — how Bing runs hundreds of concurrent experiments.
- 🔬 [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) — the reference study on LLM judges and their biases.

## Related

- [[AI Monitoring & Observability (Deep Dive)]] — online evaluation continues as monitoring.
- [[Deployment & Serving (Deep Dive)]] — shadow, canary and A/B traffic splitting.
- [[MLOps & CI-CD (Deep Dive)]] — regression evals as pipeline gates.
- [[Guardrails & AI Safety (Deep Dive)]] — safety and red-team evals.
- [[Model Selection & Training (Deep Dive)]] — what the validation set tunes.

> [!nav] Keep going
> ← [[Feature Engineering (Deep Dive)|Feature Engineering]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Deployment & Serving (Deep Dive)|Deployment & Serving]] →
> 🌱 Back to the basics: [[Evaluation & Metrics]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🎓 [Classification: Accuracy, recall, precision, and related metrics](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^2]: 🎓 [Datasets: Dividing the original dataset](https://developers.google.com/machine-learning/crash-course/overfitting/dividing-datasets) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^3]: 📄 [MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) — Google Cloud Architecture Center. Official docs. Checked 2026-11.
[^4]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Google for Developers. Official docs. Checked 2026-11.
[^5]: 🔬 [Online Controlled Experiments at Large Scale](https://exp-platform.com/large-scale/) — Kohavi et al., KDD 2013. Paper. Checked 2026-11.
[^6]: 📝 [Canary Release](https://www.martinfowler.com/bliki/CanaryRelease.html) — Danilo Sato, martinfowler.com, 2014. Article. Checked 2026-11.
[^7]: 📝 [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Anthropic Engineering, January 2026. Engineering blog. Checked 2026-11.
[^8]: 🔬 [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) — Zheng et al., arXiv 2306.05685, 2023. Paper. Checked 2026-11.
[^9]: 🔬 [Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference](https://ar5iv.labs.arxiv.org/html/2403.04132) — Chiang et al., arXiv 2403.04132, 2024. Paper. Checked 2026-11.
[^10]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/en-US/blog/michelangelo-machine-learning-platform/) — Del Balso and Hermann, Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^11]: 📝 [LMArena is now Arena](https://arena.ai/blog/lmarena-is-now-arena/) — Arena blog, January 2026. Article. Checked 2026-11.
