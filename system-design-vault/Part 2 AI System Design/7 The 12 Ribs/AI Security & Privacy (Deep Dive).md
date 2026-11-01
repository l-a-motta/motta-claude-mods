---
aliases: [AI Security & Privacy deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[AI Security & Privacy]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[AI Security & Privacy]] › 🔬 Deep Dive

> [!tldr] For engineers
> ML adds attack surface at every lifecycle stage: poisoned training data, adversarial and injected inputs at inference, memorized data leaking out, and over-privileged agents acting on attacker text. LLMs cannot reliably separate instructions from data, so **prompt injection has no known complete fix**; security comes from architecture (least privilege, authorization in code, constrained agent patterns, output gating), with differential privacy for provable data protection.

> [!basics]- New to this? Start with the basics
> [[AI Security & Privacy]] explains it with no jargon.

## How it really works

NIST's adversarial ML taxonomy organizes attacks by the type of ML method, the lifecycle stage they hit, and the attacker's goals, capabilities and knowledge.[^1] A practical map for system design:

| Stage | Attack | Attacker goal |
| --- | --- | --- |
| Data collection and training | Data poisoning, supply-chain tampering[^2] | Corrupt behavior, plant backdoors |
| Inference input | Adversarial examples, prompt injection[^3][^4] | Wrong outputs, hijacked behavior |
| Inference output | Training-data extraction, sensitive disclosure[^5][^2] | Steal private data |
| Actions and integration | Excessive agency, improper output handling[^2] | Turn the model into a confused deputy |

### The OWASP Top 10 for LLM applications (2025)

LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Supply Chain, LLM04 Data and Model Poisoning, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses, LLM09 Misinformation, LLM10 Unbounded Consumption.[^2]

### Prompt injection

OWASP defines it as user prompts that alter the model's behavior or output in unintended ways; the payload need not even be human-readable.[^3] **Direct** injection arrives in the user's own input; **indirect** injection rides in on websites, files or retrieved documents.[^3] Greshake et al. showed indirect injection against Bing's GPT-4 chat and code-completion engines, arguing that LLM-integrated apps "blur the line between data and instructions", and listed data theft, worming and ecosystem contamination as consequences.[^6]

OWASP is candid that, given how models work, "it is unclear if there are fool-proof methods of prevention".[^3] Its mitigations are layered: constrain the model's role, validate output formats with deterministic code, filter inputs and outputs, enforce least privilege with the app's own API tokens and privileged functions handled in code, require human approval for high-risk actions, segregate and label external content, and run adversarial tests that treat the model as an untrusted user.[^3]

### Anatomy of a real exploit: EchoLeak

EchoLeak (CVE-2025-32711) in Microsoft 365 Copilot enabled "remote, unauthenticated data exfiltration via a single crafted email".[^7] The chain, per the researchers' paper:[^7]

1. An external email carries instructions phrased to slip past Microsoft's cross-prompt-injection (XPIA) classifier.
2. When Copilot retrieves that email while answering a user, it follows the instructions and emits a **reference-style Markdown** link or image, which evaded link redaction.
3. The client auto-fetches the image; the URL routes through an allowed Microsoft Teams preview endpoint, so the content security policy passes it, carrying internal data out in the URL.

No user action was needed beyond Copilot processing the email.[^7] The authors' lessons: hard separation of trusted and untrusted content, provenance-based access so external content is excluded from internal answers by default, treating outputs as untrusted until a policy gate vets them, and strict default-deny egress.[^7]

### Agent patterns that resist injection

A 2025 paper by Beurer-Kellner et al. proposes a principle: once an agent has ingested untrusted input, it must be constrained so that it is "impossible" for that input to trigger consequential actions.[^8] Six patterns follow:[^8]

| Pattern | Idea |
| --- | --- |
| Action-Selector | LLM picks from a fixed menu of actions and never sees their results |
| Plan-Then-Execute | Tool sequence fixed before untrusted data is read |
| LLM Map-Reduce | Isolated LLM instances each handle one untrusted item; a constrained reduce step aggregates |
| Dual LLM | A privileged LLM plans and calls tools but never reads untrusted data; a quarantined LLM reads it with no tools |
| Code-Then-Execute | The LLM writes a program that calls tools and quarantined LLMs |
| Context-Minimization | Remove the user prompt from context once it has chosen the actions |

```python
# Dual LLM, sketched: untrusted text never reaches the model that holds tools
plan = privileged_llm.plan(user_request)            # sees only the user's request
emails = tools.search_inbox(plan.query, user=uid)   # authorization enforced in code
summary_ref = quarantined_llm.summarize(emails)     # no tools; returns an opaque value
ui.render_text(summary_ref)                         # rendered as text, never as links or actions
```

The cost is utility: these agents deliberately cannot do arbitrary tasks, and the authors recommend combining patterns per application.[^8]

### Poisoning

Carlini et al. showed two practical attacks on web-scale datasets. **Split-view poisoning** exploits that web content changes, so what curators saw differs from what later downloaders fetch; **frontrunning poisoning** times malicious edits to land in periodic snapshots of crowd-sourced sites such as Wikipedia.[^9] They estimate 0.01% of LAION-400M or COYO-700M could have been poisoned for about $60, and that the attacks applied to 10 popular datasets.[^9] OWASP adds a RAG variant: a poisoned document in the knowledge base skews answers.[^3]

### Adversarial examples

Small, worst-case perturbations make neural networks misclassify with high confidence. Goodfellow et al. attributed this to the models' largely **linear** behavior, which also explains why such examples transfer across architectures, and showed that training on generated adversarial examples reduced test error on MNIST.[^4]

### Privacy: memorization and differential privacy

Training-data extraction recovered hundreds of verbatim sequences from GPT-2, including names, phone numbers, emails, code and 128-bit UUIDs, some present in only one training document, and larger models were more vulnerable.[^5] Scrubbing obvious PII doesn't bound this risk; **differential privacy** (DP) does. NIST describes DP as "a mathematical framework that quantifies privacy loss" when an entity's data appears in a dataset, and catalogs the hazards that arise when implementing it.[^10]

Apple deploys **local** DP: each record is randomized on the device, so "the server never sees or receives raw data".[^11] In its Count Mean Sketch, each bit of a one-hot vector flips with probability 1/(e^(ε/2)+1).[^11] Records carry no device identifiers, IP addresses are discarded on arrival, and records are shuffled and split by use case.[^11]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| System-prompt hardening | Cheap; blocks naive attacks | Bypassable; never a security boundary[^3] |
| Injection classifiers | Catch known patterns at scale | Attackers phrase around them, as EchoLeak did[^7] |
| Least privilege and authz in code | Bounds blast radius regardless of model behavior | More integration work; less "magic" |
| Human approval for risky actions | Strong stop on high-impact misuse | Friction; approval fatigue |
| Constrained agent patterns | Provable resistance to injection | Less general agents[^8] |
| Local DP | Server never holds raw data[^11] | More noise per user, so more users needed for accuracy |
| Central DP | Better accuracy for the same ε | The collector must be trusted with raw data |
| Logging full prompts | Debuggable incidents | A new store of PII to protect |

## Numbers worth knowing

- **~$60** to poison **0.01%** of LAION-400M or COYO-700M; **10** datasets affected.[^9]
- **Hundreds** of verbatim training sequences extracted from GPT-2.[^5]
- **ε = 4** for Apple's emoji (2,600-item dictionary) and Safari domain (250,000 domains) collection.[^11]
- **CVE-2025-32711**: EchoLeak, fixed server-side in May 2025 and disclosed on June 11, 2025.[^7]
- **10** risk categories in the OWASP Top 10 for LLM applications, 2025 edition.[^2]
- **March 2025**: publication of both NIST AI 100-2 E2025 and NIST SP 800-226.[^1][^10]

## Failure modes

- **Classifier-only defense.** A detector is one more model to evade. Defense: architectural limits behind it.[^7]
- **Markdown and image exfiltration.** Rendered links and auto-loaded images carry data in URLs. Defense: render model output as text, strip or proxy external URLs, default-deny egress.[^7]
- **Excessive agency.** An assistant with broad tokens turns any injection into an incident. Defense: per-user, per-task scopes and approvals.[^2][^3]
- **Retrieval ignores permissions.** A RAG index built with admin rights leaks documents across users. Defense: filter retrieval by the caller's permissions, not the service's.
- **Poisoned or swapped data and models.** Mutable URLs and third-party weights change under you. Defense: pin content hashes and verify provenance.[^9][^2]
- **System prompt leakage.** Secrets in prompts get repeated. Defense: never put credentials in prompts.[^2]
- **Unbounded consumption.** Attackers run up inference costs or deny service. Defense: quotas and rate limits per user and key.[^2]

## In the real world

- **Microsoft 365 Copilot** had EchoLeak, which the paper's authors call the first real-world zero-click prompt injection in a production LLM system.[^7]
- **Bing's GPT-4-powered chat** was shown vulnerable to indirect injection in 2023 research.[^6]
- **Apple** collects emoji and Safari usage statistics under local DP.[^11]
- **OWASP** and **NIST** publish the reference taxonomies most security teams map against.[^1][^2]

## In a design interview

Start with trust boundaries, then defend in layers:

1. **Draw the boundaries:** "User input, retrieved docs and tool outputs are untrusted; only the user's identity and our code are trusted."
2. **Limit power:** "The assistant calls tools with the user's scoped token; authorization checks run in code; sends and deletes need confirmation."
3. **Contain output:** "Render as plain text, no auto-loaded images, egress allowlist."
4. **Protect data:** "Retrieval filtered by ACL, PII redacted from logs, DP for analytics."
5. **Test:** "Red-team suite of injection cases in CI."

Interviewers probe: *can't you just filter injections?* (no complete fix; limit blast radius); *how do you keep one user's data out of another's answer?* (ACL-aware retrieval); *how would you train on user data safely?* (DP, consent, retention limits).

## 🧱 Builds on

- [[Authentication (Deep Dive)]] — the request carries a verified user identity that is propagated to every tool call, instead of one shared service credential.
- [[Authorization (Deep Dive)]] — permission checks run in deterministic code at retrieval and tool time; the model is treated as an untrusted caller.
- [[Encryption (Deep Dive)]] — prompts, embeddings, logs and training sets are sensitive data needing encryption in transit and at rest; Apple sends DP reports over an encrypted channel.
- [[Rate Limiting (Deep Dive)]] — per-user quotas mitigate unbounded consumption and slow extraction or probing attacks.

## Check yourself

> [!question]- Why is "treat the model as an untrusted user" the right mental model?
> Any text the model reads can steer it, so its outputs and tool requests may reflect an attacker's intent. Authorization, validation and approvals must sit outside the model, exactly as for untrusted user input.

> [!question]- In the Dual LLM pattern, why can't the quarantined model's output flow freely back to the privileged model?
> It may contain injected instructions. The privileged model must handle it only as an opaque value passed to code or the UI, never as text it reasons over.

> [!question]- Apple uses ε = 4 with local DP. Why does local DP need many more users than central DP for the same accuracy?
> Every individual report is noised before collection, so noise accumulates across reports. Central DP adds noise once to the aggregate, but requires trusting the collector with raw data.

## Further reading

- 📄 [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) — the standard checklist for LLM app risks.
- 🔬 [Design Patterns for Securing LLM Agents against Prompt Injections](https://arxiv.org/abs/2506.08837) — the most practical architecture guidance available.
- 🔬 [EchoLeak](https://arxiv.org/html/2509.10540v1) — a full, real exploit chain with lessons.
- 🔬 [Poisoning Web-Scale Training Datasets is Practical](https://arxiv.org/abs/2302.10149) — why data provenance is a security problem.
- 📝 [Learning with Privacy at Scale](https://machinelearning.apple.com/research/learning-with-privacy-at-scale) — local differential privacy in production, explained by the team that built it.

## Related

- [[Guardrails & AI Safety (Deep Dive)]] — input and output filtering in depth.
- [[AI Agents & Tool Use (Deep Dive)]] — tool permissions and agent loops.
- [[Retrieval-Augmented Generation (Deep Dive)]] — ACL-aware retrieval and poisoned documents.
- [[Ethics & Governance (Deep Dive)]] — consent, retention and regulation of personal data.
- [[AI Monitoring & Observability (Deep Dive)]] — detecting attacks and protecting logged prompts.

> [!nav] Keep going
> ← [[MLOps & CI-CD (Deep Dive)|MLOps & CI-CD]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Cost Optimization (Deep Dive)|Cost Optimization]] →
> 🌱 Back to the basics: [[AI Security & Privacy]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations (NIST AI 100-2 E2025)](https://csrc.nist.gov/pubs/ai/100/2/e2025/final) — NIST, 2025. Standard. Checked 2026-11.
[^2]: 📄 [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) — OWASP Gen AI Security Project. Standard. Checked 2026-11.
[^3]: 📄 [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — OWASP Gen AI Security Project. Standard. Checked 2026-11.
[^4]: 🔬 [Explaining and Harnessing Adversarial Examples](https://arxiv.org/abs/1412.6572) — Goodfellow, Shlens and Szegedy, arXiv 2014. Paper. Checked 2026-11.
[^5]: 🔬 [Extracting Training Data from Large Language Models](https://www.usenix.org/conference/usenixsecurity21/presentation/carlini-extracting) — Carlini et al., USENIX Security 2021. Paper. Checked 2026-11.
[^6]: 🔬 [Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection](https://arxiv.org/abs/2302.12173) — Greshake et al., arXiv 2023. Paper. Checked 2026-11.
[^7]: 🔬 [EchoLeak: The First Real-World Zero-Click Prompt Injection Exploit in a Production LLM System](https://arxiv.org/html/2509.10540v1) — Reddy and Gujral, arXiv 2025. Paper. Checked 2026-11.
[^8]: 🔬 [Design Patterns for Securing LLM Agents against Prompt Injections](https://arxiv.org/html/2506.08837) — Beurer-Kellner et al., arXiv 2025. Paper. Checked 2026-11.
[^9]: 🔬 [Poisoning Web-Scale Training Datasets is Practical](https://arxiv.org/abs/2302.10149) — Carlini et al., arXiv 2023. Paper. Checked 2026-11.
[^10]: 📄 [Guidelines for Evaluating Differential Privacy Guarantees (SP 800-226)](https://csrc.nist.gov/pubs/sp/800/226/final) — NIST, 2025. Standard. Checked 2026-11.
[^11]: 📝 [Learning with Privacy at Scale](https://machinelearning.apple.com/research/learning-with-privacy-at-scale) — Apple Machine Learning Research, 2017. Engineering blog. Checked 2026-11.
