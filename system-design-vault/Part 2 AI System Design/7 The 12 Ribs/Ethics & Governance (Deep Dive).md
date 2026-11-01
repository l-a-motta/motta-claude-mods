---
aliases: [Ethics & Governance deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Ethics & Governance]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Ethics & Governance]] › 🔬 Deep Dive

> [!tldr] For engineers
> Treat responsible AI as a system with inputs, checks and records: a **risk classification** per use case, a **fairness criterion chosen on purpose** and measured per group, **documentation artifacts** (datasheets, model cards), **explanations** where decisions affect people, **human oversight and audit logs**, and a governance loop (NIST AI RMF's Govern, Map, Measure, Manage) mapped to legal duties such as the EU AI Act and GDPR Article 22. The hard parts: fairness metrics conflict, proxies leak protected attributes, and regulatory dates move.

> [!basics]- New to this? Start with the basics
> [[Ethics & Governance]] explains it with no jargon.

## How it really works

### Where bias comes from

- **Historical bias.** Labels encode past decisions. Amazon's résumé screener, trained on ten years of mostly male applicants, penalized "women's" and two all-women's colleges.[^1]
- **Representation bias.** Two widely used face benchmarks, IJB-A and Adience, were 79.6% and 86.2% lighter-skinned subjects; on a balanced set, three commercial classifiers misclassified darker-skinned women up to 34.7% of the time versus 0.8% for lighter-skinned men.[^2]
- **Proxies.** Dropping a protected attribute does not remove it. Amazon edited out the obvious terms but could not guarantee the model would not find other discriminatory signals.[^1]

### Fairness is a choice of metric

Fairlearn's user guide defines the common group criteria:[^3]

| Criterion | Requires equal across groups | Use when (per Fairlearn) |
| --- | --- | --- |
| Demographic parity | Selection rate | Input data is known to contain bias |
| Equalized odds | True positive rate and false positive rate | Labels are trustworthy and both error types matter about equally |
| Equal opportunity | True positive rate only | Missing true positives harms more than extra false positives |

These cannot generally coexist. Kleinberg, Mullainathan and Raghavan proved that, except in highly constrained special cases, no method satisfies their three fairness conditions simultaneously.[^4] The COMPAS debate is the canonical illustration: ProPublica found that 44.9% of Black defendants labeled higher risk did not reoffend, versus 23.5% of white defendants, while the vendor, Northpointe, disputed the analysis.[^5] The engineering takeaway: pick the criterion that matches the harm, write it down as a requirement, and report the others.

```python
from fairlearn.metrics import MetricFrame, selection_rate, false_positive_rate

mf = MetricFrame(
    metrics={"selection_rate": selection_rate, "fpr": false_positive_rate},
    y_true=y_test, y_pred=y_pred, sensitive_features=df_test["group"],
)
print(mf.by_group)          # per-group table for the model card
print(mf.difference())      # max gap per metric; gate releases on it
```

### Explainability

**SHAP** (SHapley Additive exPlanations) assigns each feature an importance value for a particular prediction, and unifies six earlier explanation methods under one additive framework.[^6] Use it for **local** explanations ("why was this applicant declined?") and aggregate it for **global** ones. For LLM features, explanation usually means showing retrieved sources and logging the exact prompt, context and model version, since token-level attributions rarely satisfy a user or a regulator.

### Documentation artifacts

- **Datasheets for datasets** record motivation, composition, collection process and recommended uses, by analogy with electronic-component datasheets.[^7]
- **Model cards** accompany a trained model with its intended use, evaluation procedure and benchmarked results across demographic, cultural, phenotypic and intersectional groups.[^8]
- On the **Hugging Face Hub** a model card is the repo's `README.md` with YAML metadata (license, datasets, base model, evaluation results); the text should cover intended uses, limitations, biases and ethical considerations.[^9]

### Governance frameworks

The **NIST AI Risk Management Framework 1.0** (January 26, 2023) is voluntary; a Generative AI Profile followed on July 26, 2024, and the framework is under revision.[^10] Its core has four functions: **Govern** is cross-cutting and "infused throughout AI risk management"; **Map** establishes the context to frame risks; **Measure** applies quantitative and qualitative tools; **Manage** allocates resources to mapped and measured risks on a regular basis.[^11]

### The EU AI Act

The Commission calls it the first-ever comprehensive legal framework on AI worldwide.[^12] It is risk-tiered:[^12]

- **Unacceptable:** banned practices such as social scoring, harmful manipulation and untargeted facial-image scraping.
- **High-risk:** for example CV sorting, credit scoring, exam scoring and biometric identification. Providers need risk management, high-quality datasets, activity logging, technical documentation, information for deployers, human oversight, and robustness, cybersecurity and accuracy.
- **Transparency:** chatbots must disclose they are machines; generated content and deepfakes must be identifiable or labeled.
- **Minimal:** spam filters, video games; no specific rules.

General-purpose model providers have transparency and copyright duties, plus risk assessment for models with systemic risk.[^12] Penalties reach €35 million or 7% of worldwide turnover for prohibited practices, €15 million or 3% for most other obligations, and €7.5 million or 1% for misleading information to authorities; for SMEs the lower amount applies.[^13]

Separately, **GDPR Article 22** gives people the right not to be subject to decisions based solely on automated processing that produce legal or similarly significant effects; where such decisions are allowed, safeguards include human intervention and the right to contest.[^14]

### Governance as code

Policies hold only if the pipeline enforces them. A typical deploy gate:

```yaml
release_policy:
  requires:
    - model_card: { sections: [intended_use, limitations, eval_by_group] }
    - fairness_eval: { metric: equal_opportunity_gap, max: 0.05 }
    - risk_tier: assigned            # e.g. high-risk under the AI Act
    - approval: { role: model-risk-reviewer, not_same_as: author }
  runtime:
    audit_log: [request_id, model_version, inputs_hash, output, reviewer]
    human_review: required_when_risk_tier == "high"
```

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Demographic parity | Equal outcomes when labels are biased | Can reduce accuracy; may conflict with error-rate parity |
| Equalized odds | Equal error rates | Needs trustworthy labels; can conflict with calibration |
| Inherently interpretable model | Explanations are exact | Often less accurate on complex data |
| Black box plus SHAP | Accuracy plus local explanations | Explanations are approximations that can mislead |
| Human review of every decision | Strong oversight | Slow and expensive; reviewers rubber-stamp under load |
| Sampled or risk-triggered review | Scales | Some harmful decisions slip through |
| Log full inputs and outputs | Complete audit trail | Privacy and retention exposure |
| Build to the strictest regime | One process everywhere | Over-compliance cost in low-risk markets |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Max misclassification, darker-skinned women vs lighter-skinned men (2018) | 34.7% vs 0.8%[^2] |
| Lighter-skinned share of IJB-A / Adience | 79.6% / 86.2%[^2] |
| COMPAS "higher risk" who did not reoffend, Black vs white | 44.9% vs 23.5%[^5] |
| COMPAS violent-crime predictions that came true | 20%[^5] |
| AI Act maximum fine, prohibited practices | €35M or 7% of worldwide turnover[^13] |
| AI Act in force / prohibitions / GPAI rules | 1 Aug 2024 / 2 Feb 2025 / 2 Aug 2025[^12] |
| General application and transparency rules | 2 Aug 2026[^12] |
| High-risk rules: Annex III / Annex I | 2 Dec 2027 / 2 Aug 2028[^12] |
| NIST AI RMF 1.0 / GenAI Profile | 26 Jan 2023 / 26 Jul 2024[^10] |

## Failure modes

- **Proxy discrimination.** Removing protected fields leaves correlated ones (words, schools, postcodes). Test outcomes by group, which requires collecting the attribute under strict access control.[^1]
- **Aggregate metrics hide subgroups.** Report per-group and intersectional results, as model cards prescribe.[^8]
- **Unexamined metric choice.** Optimizing one fairness criterion silently worsens another.[^4] Record which one you chose and why.
- **Stale documentation.** A fine-tune or new data invalidates the model card. Regenerate the card and its evals in the training pipeline.
- **Rubber-stamp oversight.** Reviewers approve whatever the model suggests. Measure override rates and give reviewers the explanation, not just the score.
- **Regulatory drift.** The AI Omnibus, in force since 27 July 2026, moved the high-risk deadlines to December 2027 and August 2028.[^12] Track dates in one owned register.

## In the real world

- **Amazon** abandoned its résumé-scoring model after it learned gender proxies.[^1]
- **COMPAS (Northpointe)**: ProPublica found Black defendants nearly twice as likely to be wrongly labeled higher risk; Northpointe disputed the methodology.[^5]
- **Gender Shades** showed how a benchmark balanced by skin type and gender exposes error gaps that skewed benchmarks hide.[^2]
- **Hugging Face** renders each model repo's `README.md` as its model card, with metadata used for search and filtering.[^9]
- **NIST** and the **European Commission** provide the framework and the law most programs map to.[^11][^12]

## In a design interview

For any system that decides about people (loans, hiring, moderation), say early:

1. **Tier:** "Credit scoring is high-risk under the EU AI Act, so logging, documentation and human oversight are requirements."
2. **Metric:** "Approval errors harm applicants most, so equal opportunity on true positives, with a 5-point gap budget, reported alongside demographic parity."
3. **Explain:** "SHAP top factors shown to reviewers and in adverse-action notices."
4. **Oversight:** "Declines go to a human queue; customers can contest."
5. **Record:** "Model card and datasheet versioned with the model; audit log per decision."

Interviewers probe: *Why not just drop the protected attribute?* (Proxies; you need it to measure.) *Which fairness metric?* (Depends on harm; they conflict.) *How do you keep it true after launch?* (Per-group monitoring, re-evaluation gates on retrain.)

## 🧱 Builds on

- [[Logging (Deep Dive)]] — structured, retained, tamper-evident decision logs provide the traceability the AI Act requires of high-risk systems.
- [[Authorization (Deep Dive)]] — role-based approvals, separation of duties and least-privilege access to sensitive attributes make governance enforceable.
- [[Requirements (Deep Dive)]] — fairness thresholds, explanation needs and legal duties become non-functional requirements with acceptance criteria.

## Check yourself

> [!question]- Your model meets demographic parity, but false negative rates differ sharply by group. Is it fair?
> By one definition yes, by another no. The criteria conflict in general, so the answer depends on which harm matters more in this use case. State the chosen criterion, justify it, and report the others.

> [!question]- Why is collecting a protected attribute sometimes necessary for fairness?
> Without it you cannot measure per-group outcomes or detect proxy discrimination. Store it separately, restrict access, and use it for evaluation rather than as a model input.

> [!question]- A deployed hiring screener is fine-tuned on new data. What governance steps must rerun?
> Per-group evaluation, the model card and datasheet updates, risk-tier review, and approval by someone other than the author before redeploying, with the new model version recorded in the audit log.

## Further reading

- 🔬 [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993) — the paper that defined the standard model documentation format.
- 🔬 [Gender Shades](https://proceedings.mlr.press/v81/buolamwini18a.html) — a short, influential audit showing why per-group evaluation matters.
- 📄 [Common fairness metrics](https://fairlearn.org/main/user_guide/assessment/common_fairness_metrics.html) — plain definitions and when each metric fits.
- 📄 [AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) — the Commission's own summary, risk tiers and current timeline.
- 📄 [5 AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) — NIST's Govern, Map, Measure, Manage functions in detail.

## Related

- [[Guardrails & AI Safety (Deep Dive)]] — runtime controls that enforce policy on outputs.
- [[AI Security & Privacy (Deep Dive)]] — data minimization and access control for sensitive attributes.
- [[Evaluation & Metrics (Deep Dive)]] — sliced evaluation and fairness metrics in the eval suite.
- [[Data Engineering & Pipelines (Deep Dive)]] — lineage and datasheets for training data.
- [[AI Monitoring & Observability (Deep Dive)]] — per-group drift and outcome monitoring after launch.

> [!nav] Keep going
> ← [[AI Reliability & Fault Tolerance (Deep Dive)|AI Reliability & Fault Tolerance]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Context Engineering (Deep Dive)|Context Engineering]] →
> 🌱 Back to the basics: [[Ethics & Governance]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Amazon scraps secret AI recruiting tool that showed bias against women](https://www.euronews.com/2018/10/10/amazon-scraps-secret-ai-recruiting-tool-that-showed-bias-against-women) — Jeffrey Dastin, Reuters (via Euronews), 2018. Article. Checked 2026-11.
[^2]: 🔬 [Gender Shades: Intersectional Accuracy Disparities in Commercial Gender Classification](https://proceedings.mlr.press/v81/buolamwini18a.html) — Buolamwini and Gebru, FAT* 2018 (PMLR 81). Paper. Checked 2026-11.
[^3]: 📄 [Common fairness metrics](https://fairlearn.org/main/user_guide/assessment/common_fairness_metrics.html) — Fairlearn user guide. Official docs. Checked 2026-11.
[^4]: 🔬 [Inherent Trade-Offs in the Fair Determination of Risk Scores](https://arxiv.org/abs/1609.05807) — Kleinberg, Mullainathan and Raghavan, 2016. Paper. Checked 2026-11.
[^5]: 📝 [Machine Bias](https://www.propublica.org/article/machine-bias-risk-assessments-in-criminal-sentencing) — Angwin, Larson, Mattu and Kirchner, ProPublica, 2016. Article. Checked 2026-11.
[^6]: 🔬 [A Unified Approach to Interpreting Model Predictions](https://arxiv.org/abs/1705.07874) — Lundberg and Lee, NIPS 2017. Paper. Checked 2026-11.
[^7]: 🔬 [Datasheets for Datasets](https://arxiv.org/abs/1803.09010) — Gebru et al., 2018. Paper. Checked 2026-11.
[^8]: 🔬 [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993) — Mitchell et al., FAT* 2019. Paper. Checked 2026-11.
[^9]: 📄 [Model Cards](https://huggingface.co/docs/hub/model-cards) — Hugging Face Hub documentation. Official docs. Checked 2026-11.
[^10]: 📄 [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — National Institute of Standards and Technology. Official docs. Checked 2026-11.
[^11]: 📄 [5 AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) — NIST Trustworthy and Responsible AI Resource Center. Official docs. Checked 2026-11.
[^12]: 📄 [AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) — European Commission, Shaping Europe's digital future. Official docs. Checked 2026-11.
[^13]: 📄 [Article 99: Penalties](https://artificialintelligenceact.eu/article/99/) — EU AI Act text, artificialintelligenceact.eu (unofficial explorer). Legal text. Checked 2026-11.
[^14]: 📄 [Art. 22 GDPR: Automated individual decision-making, including profiling](https://gdpr-info.eu/art-22-gdpr/) — GDPR text, gdpr-info.eu (unofficial consolidation). Legal text. Checked 2026-11.
