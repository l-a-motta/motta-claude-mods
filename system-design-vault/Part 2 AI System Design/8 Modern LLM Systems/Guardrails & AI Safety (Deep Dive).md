---
aliases: [Guardrails & AI Safety deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[Guardrails & AI Safety]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[Guardrails & AI Safety]] › 🔬 Deep Dive

> [!tldr] For engineers
> Guardrails are **defense in depth around a non-deterministic component**: classifiers and deterministic validators on inputs, retrieved content, tool calls and outputs, plus privilege controls and human approval for consequential actions. No filter is complete, since prompt injection has no known foolproof fix, so the architecture must assume the model will sometimes be wrong or hijacked and **bound the blast radius** in code. Tune every rail for both catch rate and over-refusal, and pay for it in latency and compute.

> [!basics]- New to this? Start with the basics
> [[Guardrails & AI Safety]] explains it with no jargon.

## How it really works

### What you are defending against

NIST's Generative AI Profile lists 12 risks unique to or exacerbated by generative AI, including **confabulation**, dangerous or hateful content, data privacy, harmful bias, human-AI configuration (over-reliance, automation bias), information integrity and information security.[^1] It defines confabulation as "confidently stated but erroneous or false content," noting it is a natural result of models approximating their training distribution.[^1]

For application builders, OWASP's Top 10 for LLMs sharpens the security side:

- **Prompt injection (LLM01).** *Direct*: the user's own input changes behavior. *Indirect*: instructions arrive in external content the model reads (web pages, files). Jailbreaking is the subset aimed at bypassing safety training entirely.[^2] OWASP states it is unclear whether foolproof prevention exists.[^2]
- **Excessive agency (LLM06).** Damage happens because an agent has excessive functionality, permissions or autonomy, whatever made the model misbehave.[^3]

Simon Willison's **lethal trifecta** names the dangerous combination: access to private data, exposure to untrusted content, and a way to communicate externally. With all three, an injected instruction can exfiltrate data.[^4]

### Where rails sit

NVIDIA's NeMo Guardrails formalizes five interception points:[^5]

| Rail | Runs on | Typical checks |
| --- | --- | --- |
| Input | User message | Jailbreak and injection detection, topic limits, PII masking |
| Retrieval | Retrieved chunks | Document injection, relevance, sensitive data |
| Dialog | Conversation flow | Scripted flows (Colang), allowed intents |
| Execution | Tool inputs and outputs | Argument validation, allow-lists |
| Output | Model response | Moderation, format, grounding, leakage |

### The control toolbox

**Moderation classifiers.** OpenAI's `omni-moderation-latest` scores text and images across categories such as harassment, hate, self-harm, sexual, violence and illicit, returning `flagged`, per-category booleans and 0–1 `category_scores`. It is free; OpenAI says to treat scores as policy signals, not automatic blocks, and to recalibrate thresholds as the model is upgraded.[^6]

**LLM-based safety classifiers.** **Llama Guard** is a 7B Llama 2 model instruction-tuned to classify both prompts and responses against a safety taxonomy you can change zero- or few-shot; it matched or beat existing moderation tools on the OpenAI Moderation and ToxicChat benchmarks.[^7]

**Injection detectors.** Azure's **Prompt Shields** separate *user prompt attacks* (rule changes, conversation mockups, role-play, encoding attacks) from *document attacks* embedded in emails, web pages or tool responses. **Spotlighting** base64-encodes untrusted documents so the model treats them as lower trust, at the cost of more tokens.[^8]

**Trained input/output classifiers at the model layer.** Anthropic's **Constitutional Classifiers** are trained on synthetic data generated from a natural-language constitution of allowed and disallowed content.[^9]

**Grounding against hallucination.** Allow "I don't know", extract direct quotes before answering over long documents, require a supporting quote for each claim and retract unsupported ones, and compare best-of-N samples for inconsistency. These reduce hallucination but do not eliminate it.[^10]

**Deterministic controls.** Specify output formats and validate them in code; give the app its own scoped API tokens; handle privileged functions in code, not through the model; segregate and label untrusted content; and require human approval for privileged operations.[^2] Enforce authorization downstream ("complete mediation") rather than asking the model whether an action is allowed.[^3]

```python
def guarded_turn(user, msg):
    if shields.user_attack(msg) or moderation.flagged(msg):
        return refuse(log_reason="input")             # input rail
    docs = [d for d in retrieve(msg) if not shields.document_attack(d)]
    out = llm(system=POLICY, user=msg, documents=label_untrusted(docs))
    if not schema_valid(out) or moderation.flagged(out.text):
        return refuse(log_reason="output")            # output rail
    for call in out.tool_calls:
        authorize(user, call)                         # code decides, not the model
        if call.high_impact:
            await_human_approval(call)
    return out
```

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Keyword / regex rules | Fast, cheap, explainable | Trivially bypassed by paraphrase or encoding |
| Hosted moderation API | Free or cheap, broad categories | Fixed taxonomy; thresholds drift with model updates[^6] |
| LLM-as-guard (Llama Guard) | Custom taxonomy, context-aware | One extra 7B-model call per check[^7] |
| Trained in-model classifiers | Strong jailbreak resistance | Compute overhead; some over-refusal[^9] |
| Block vs. annotate mode | Block stops harm; annotate keeps UX smooth while tuning | False positives vs. leaked harm[^8] |
| Human approval | Highest assurance for irreversible actions | Slow, expensive, approval fatigue |
| Architectural isolation (break the trifecta) | Removes whole attack classes | Less capable agent[^4] |

Rule of thumb: **probabilistic rails reduce frequency; deterministic controls bound impact.** Use both.

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Jailbreak success, no classifiers → Constitutional Classifiers | 86% → 4.4% on 10,000 synthetic prompts[^9] |
| Extra refusals on harmless traffic | +0.38% (not statistically significant)[^9] |
| Compute overhead of those classifiers | +23.7%[^9] |
| Red-team effort, prototype bug bounty | 183 participants, 3,000+ hours, no universal jailbreak[^9] |
| Llama Guard size | 7B parameters[^7] |
| OpenAI moderation price / image limit | Free / 20 MB[^6] |
| Prompt Shields standalone API | 1 user prompt + up to 5 documents per call[^8] |
| NIST GenAI risk categories | 12[^1] |
| Vendor "95% of attacks caught" claims | A failing grade in web security[^4] |

## Failure modes

- **Over-refusal.** Strict rails block legitimate users; measure false positives on real traffic and start in annotate mode.[^8]
- **Indirect injection.** Attacks ride in through retrieved documents and tool results, not the user box; scan documents and tool responses, not only prompts.[^8][^2]
- **Encoding and role-play bypasses.** Ciphers, URL encoding and persona tricks evade naive filters.[^8]
- **Language gaps.** Prompt Shields are trained and evaluated mainly on English; test every language you serve.[^8]
- **Threshold drift.** A provider upgrades its classifier and your tuned cut-offs shift.[^6]
- **Prompt-only defenses.** LLMs cannot reliably tell trusted instructions from ones embedded in content, so telling a model to ignore attacks reduces risk but guarantees nothing.[^4]
- **Over-trust by humans.** Automation bias leads reviewers to rubber-stamp; NIST lists this under human-AI configuration.[^1]
- **Confident wrong answers in production.** Air Canada's chatbot invented a post-travel refund rule; the tribunal held the airline liable, calling the chatbot "still just a part of Air Canada's website."[^11]

## In the real world

- **Anthropic** built constitutional input and output classifiers as a research system, red-teamed a prototype through a bug bounty, then ran a public demo; there, one of 339 participants found a universal jailbreak.[^9]
- **Llama Guard**'s authors released its weights, so teams can self-host input and output classification.[^7]
- **Microsoft Azure** ships Prompt Shields and Spotlighting as configurable guardrail controls in Foundry.[^8]
- **NVIDIA NeMo Guardrails** offers input, retrieval, dialog, execution and output rails as an open-source Python package or OpenAI-compatible server.[^5]
- **Air Canada (2024)** is the standard cautionary tale on hallucination liability.[^11]

## In a design interview

1. **Threat model first.** Who are the users, what can the model touch, what is the worst action? Check for the lethal trifecta.[^4]
2. **Layer rails.** Input: injection and moderation. Retrieval: document attacks. Execution: allow-listed tools with validated arguments. Output: moderation, schema and grounding checks.
3. **Bound impact in code.** Scoped credentials, downstream authorization, per-user rate limits, human approval for irreversible actions.[^3]
4. **Measure.** Catch rate on a red-team set and false-positive rate on real traffic; budget the added latency.
5. **Operate.** Log every block with its reason, review samples, retune thresholds, red-team continuously.[^2]

Interviewers probe: *How do you handle a poisoned document in the RAG index?* *What is your false-positive budget?* *Why not just tell the model to ignore malicious instructions?* *Where does the human step sit, and what does it cost?*

## 🧱 Builds on

- [[Rate Limiting]] — per-user and per-tool limits cap how many undesirable actions can happen in a given period, limiting damage when other rails miss.[^3]
- [[Authorization]] — complete mediation: downstream systems enforce what the end user may do, so a hijacked model cannot exceed the user's own rights.[^3]
- [[Logging]] — structured logs of blocks, tool calls and approvals feed audits, incident response and threshold tuning; OWASP lists monitoring as a damage limiter.[^3]

## Check yourself

> [!question]- Why is a 99%-accurate injection classifier insufficient on its own for an email agent that can send mail?
> The attacker retries until one of the 1% gets through, and a single success can exfiltrate the inbox. You must remove a leg of the trifecta or require approval for outbound mail, so a miss cannot cause harm.

> [!question]- Your moderation rail suddenly blocks twice as many messages with no traffic change. What happened?
> Likely the provider upgraded the classifier and its score distribution moved. Recalibrate thresholds against a labeled sample, and pin or monitor versions.

> [!question]- How do you reduce hallucinations in a policy Q&A bot without retraining?
> Ground answers in retrieved policy text, require quotes for each claim and retract unsupported ones, allow "I don't know", and add an output check that verifies claims against the source.

## Further reading

- 📄 [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — the canonical definition and mitigation list.
- 📝 [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — the clearest mental model for agent injection risk.
- 📝 [Constitutional Classifiers](https://www.anthropic.com/research/constitutional-classifiers) — real catch-rate, over-refusal and cost numbers.
- 🔬 [Llama Guard](https://arxiv.org/abs/2312.06674) — how an LLM becomes a configurable safety classifier.
- 📄 [Prompt Shields in Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection) — a practical taxonomy of direct and document attacks.
- 📄 [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) — the U.S. reference list of generative AI risks and actions.

## Related

- [[AI Security & Privacy (Deep Dive)]] — data protection and the wider attack surface.
- [[AI Agents & Tool Use (Deep Dive)]] — tool permissions and approval gates.
- [[Retrieval-Augmented Generation (Deep Dive)]] — grounding, and the documents that carry indirect injection.
- [[Evaluation & Metrics (Deep Dive)]] — measuring catch rate and false positives.
- [[Rate Limiting (Deep Dive)]] — the algorithms behind abuse limits.

> [!nav] Keep going
> ← [[AI Agents & Tool Use (Deep Dive)|AI Agents & Tool Use]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[Capstone - AI Support Assistant (Deep Dive)|Capstone - AI Support Assistant]] →
> 🌱 Back to the basics: [[Guardrails & AI Safety]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) — NIST, 2024. Standard. Checked 2026-11.
[^2]: 📄 [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — OWASP Gen AI Security Project. Standard. Checked 2026-11.
[^3]: 📄 [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — OWASP Gen AI Security Project. Standard. Checked 2026-11.
[^4]: 📝 [The lethal trifecta for AI agents: private data, untrusted content, and external communication](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — Simon Willison, 2025. Article. Checked 2026-11.
[^5]: 📄 [NVIDIA NeMo Guardrails](https://docs.nvidia.com/nemo/guardrails/latest/index.html) — NVIDIA documentation. Official docs. Checked 2026-11.
[^6]: 📄 [Moderation](https://developers.openai.com/api/docs/guides/moderation) — OpenAI API documentation. Official docs. Checked 2026-11.
[^7]: 🔬 [Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations](https://arxiv.org/abs/2312.06674) — Inan et al., 2023. Paper. Checked 2026-11.
[^8]: 📄 [Prompt Shields in Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection) — Microsoft Learn. Official docs. Checked 2026-11.
[^9]: 📝 [Constitutional Classifiers: Defending against universal jailbreaks](https://www.anthropic.com/research/constitutional-classifiers) — Anthropic, 2025. Research blog. Checked 2026-11.
[^10]: 📄 [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations) — Anthropic, Claude API documentation. Official docs. Checked 2026-11.
[^11]: 📝 [Air Canada must pay refund promised by AI chatbot, tribunal rules](https://ca.news.yahoo.com/air-canada-must-pay-refund-040527669.html) — The Hill, via Yahoo News Canada, 2024. Article. Checked 2026-11.
