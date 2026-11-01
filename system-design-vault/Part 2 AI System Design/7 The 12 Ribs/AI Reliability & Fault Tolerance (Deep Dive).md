---
aliases: [AI Reliability & Fault Tolerance deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[AI Reliability & Fault Tolerance]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[AI Reliability & Fault Tolerance]] › 🔬 Deep Dive

> [!tldr] For engineers
> AI systems fail four ways: **hard errors** (429, 5xx, 529 overloaded), **latency** (long generations, hung streams), **capacity** (GPU or regional shortages, whole-provider outages) and **silent quality regressions**. The defenses are bounded, jittered retries at one layer; deadline-aware timeouts and streaming; ordered fallback chains across models, regions and providers with cooldowns; load shedding and graceful degradation; queues for non-interactive work; continuous quality evals on production traffic; and a practiced incident process.

> [!basics]- New to this? Start with the basics
> [[AI Reliability & Fault Tolerance]] explains it with no jargon.

## How it really works

### Classify the error before reacting

Not every failure deserves a retry. Anthropic's API distinguishes `429 rate_limit_error`, `500 api_error` (retry with exponential backoff), `504 timeout_error` (use streaming for long requests) and `529 overloaded_error`, which can occur when the API sees high traffic across all users.[^1] A 429 caused by a tier spend cap carries no `retry-after` header and keeps failing until access resumes, so retrying it is pure waste.[^1] A sharp jump in your own traffic can also trigger 429s from acceleration limits; ramp up gradually.[^1]

OpenAI's guidance is similar: honor `Retry-After` as a minimum and add a small random delay, fall back to exponential backoff with jitter when the header is absent, cap attempts and total retry time, and never retry quota or billing errors.[^2] Failed requests still count against your per-minute limit, so hammering does not help.[^2]

Two LLM-specific wrinkles:

- **Mid-stream errors.** With server-sent events, an error can arrive after the API has already returned `200`, so the HTTP status alone does not tell you the call succeeded.[^1]
- **Long requests.** Anthropic recommends streaming or the batch API for requests that may run past 10 minutes, because idle connections can be dropped by networks along the way.[^1]

### Retries: bounded, jittered, at one layer

Amazon's Builders' Library calls retries "selfish": each one spends more server time for a better chance of success, which is fine for transient faults and harmful under overload.[^3] In a five-deep call stack with three retries per layer, a failing database can see 243× the load.[^3] The rules: set timeouts from a downstream latency percentile (Amazon picks an acceptable false-timeout rate such as 0.1% and uses p99.9), retry at a single point in the stack, add jitter, and make side-effecting calls idempotent before retrying them.[^3] The official Claude SDK already retries transient failures twice with backoff, so an application that adds its own loop should disable or account for SDK retries.[^1][^2]

```python
def generate(prompt, chain, deadline_s=20):
    """chain: ordered list of (client, model). Stops at the overall deadline."""
    start = time.monotonic()
    for client, model in chain:                         # primary, then fallbacks
        for attempt in range(2):                        # small, bounded retries
            if time.monotonic() - start > deadline_s:
                return degraded_answer(prompt)
            try:
                return client.generate(model, prompt, timeout=deadline_s)
            except (Overloaded, ServerError, Timeout):
                time.sleep(random.uniform(0, 0.5 * 2 ** attempt))   # full jitter
            except (BadRequest, QuotaExceeded):
                break                                   # not retryable here
    return degraded_answer(prompt)                      # cached, simpler or honest
```

### Fallback chains

A gateway such as LiteLLM encodes the chain in config: `num_retries` per model group, an ordered `fallbacks` list, a `request_timeout`, and cooldowns that pull a deployment out of rotation after `allowed_fails` failures within `cooldown_time` seconds.[^4] It also supports specialized fallbacks: `context_window_fallbacks` (route to a larger-context model when the prompt does not fit) and `content_policy_fallbacks`.[^4]

```yaml
router_settings: { allowed_fails: 3, cooldown_time: 30, enable_pre_call_checks: true }
litellm_settings:
  num_retries: 2
  request_timeout: 10
  fallbacks: [{"primary-model": ["same-model-other-region", "other-provider-model"]}]
  context_window_fallbacks: [{"small-model": ["large-context-model"]}]
```

The cheapest fallback is the **same model in another region**. Amazon Bedrock's cross-Region inference profiles route requests across Regions within a geography or globally, but AWS still tells you to add bounded retries and multi-Region or multi-model fallback in your application to meet an availability target.[^5] A **different provider** survives a whole-provider outage but behaves differently, so prompts and evals must be validated on every model in the chain.

### Circuit breakers, load shedding, graceful degradation

A circuit breaker counts failures; when they cross a threshold it opens and rejects calls immediately, then lets a trial call through after a reset interval (half-open).[^6] It stops callers exhausting threads on a sick dependency and gives the dependency room to recover; the open state needs a planned fallback, such as stale data that is "good enough."[^6] AWS's caveat: breakers introduce modal behavior that is hard to test, and a local token bucket that limits retries can be gentler.[^3]

For AI features, graceful degradation usually means a smaller model, a cached or retrieved answer without generation, a non-AI path (search results instead of a summary), or a clear message.

### Queues for work that can wait

Anything not interactive (document processing, evals, enrichment) belongs behind a [[Message Queues (Deep Dive)|queue]] with retries and a dead-letter queue, so an outage becomes a delay, not data loss. Batch APIs make the same trade at the provider: you poll for results instead of holding a connection open.[^1]

### Silent quality regressions

In August–September 2025, Anthropic shipped three unrelated infrastructure bugs: a context-window routing error, a TPU misconfiguration that corrupted output, and an XLA compiler miscompilation in approximate top-k sampling.[^7] Their evals did not catch the degradation, partly because the model often recovers from isolated mistakes; privacy controls limited access to failing conversations; and routing was sticky, so affected users kept hitting bad servers.[^7] Their fixes: more sensitive evals, continuous quality evals on production systems, and faster privacy-preserving debugging tools.[^7] Lesson: uptime and error rate are not enough; run canary prompts and sampled quality scoring on live traffic, per model, per region, per hardware platform.

### Training jobs fail constantly

During a 54-day snapshot of Llama 3 pre-training on up to 16K H100 GPUs, Meta saw 466 job interruptions, 419 of them unexpected; GPU issues caused 58.7% of the unexpected ones.[^8] Automation kept effective training time above 90%, and significant manual intervention was needed only three times.[^8] At that scale, frequent checkpoints, fast restart and automatic bad-node eviction are the reliability design.

### Incident response

Google's SRE book separates roles (incident commander, operations, communications, planning), keeps a living incident document, demands explicit handoffs, and says to declare early: if a second team is needed, customers can see it, or an hour of focused analysis hasn't solved it.[^9]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Retry same model | Fixes transient errors cheaply | Adds load during overload |
| Same model, other region | Same behavior; survives a regional fault | Data-residency rules; shared global capacity |
| Different model, same provider | Survives a model-specific overload | Quality and format differences |
| Different provider | Survives a whole-provider outage | Separate contracts, evals, prompt tuning |
| Circuit breaker | Fails fast; protects the dependency | Modal behavior that is hard to test |
| Retry token bucket | Smooth, bounded retry load | Some requests fail that a retry would have saved |
| Degraded non-AI path | Always available | Lower usefulness; must be built and kept working |
| Async queue | Outage becomes delay | Not usable for interactive chat |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| OpenAI outage, Dec 11 2024 | 3:16 to 7:38 PM PST, about 4 h 22 min, all services[^10] |
| DNS caching delayed visible failure | About 20 minutes[^10] |
| Anthropic misrouting at worst hour (Aug 31 2025) | 16% of Sonnet 4 requests[^7] |
| Claude Code users with at least one misrouted message | About 30%[^7] |
| Llama 3 pre-training interruptions (54 days) | 466 total, 419 unexpected, 58.7% GPU-related[^8] |
| Load amplification, 5 layers × 3 retries | 243×[^3] |
| Amazon timeout rule of thumb | p99.9 latency, for about 0.1% false timeouts[^3] |
| Claude SDK default retries | 2, with exponential backoff[^1] |

## Failure modes

- **Retry storms.** Every client retries an overloaded provider and keeps it overloaded. Defend with jitter, single-layer retries and retry budgets.[^3]
- **Correlated failover.** When a big provider fails, many customers fail over to the same backup at once, and the backup's rate limits trip. Hold reserved capacity or pre-negotiated limits with the fallback, and shed low-priority traffic first.
- **Fallback that doesn't fit.** The backup has a smaller context window or different tool-calling format, so failover itself errors. Pre-call checks and context-window fallbacks catch this.[^4]
- **Sticky bad routing.** Session affinity keeps sending a user to a degraded server.[^7] Break stickiness on error and monitor per-backend quality.
- **Control-plane dependency.** OpenAI's outage began when a telemetry service overloaded Kubernetes API servers that DNS-based service discovery depended on, and the fix needed that same control plane.[^10] Their remediation: phased rollouts, fault-injection tests, break-glass access, and decoupling the data plane from the control plane.[^10]
- **Non-retryable errors retried.** Spend-cap 429s and invalid requests never succeed on retry.[^1]

## In the real world

- **OpenAI** published a detailed write-up of its December 2024 outage and its remediations.[^10]
- **Anthropic** published a postmortem of three quality-degrading infrastructure bugs and how detection failed.[^7]
- **Meta** documented failure categories and automated recovery for Llama 3 training at 16K-GPU scale.[^8]
- **LiteLLM** and similar gateways implement retries, fallbacks and cooldowns as config.[^4]
- **Amazon Bedrock** offers geographic and global cross-Region inference profiles for capacity resilience.[^5]

## In a design interview

State the availability target and what "available" means for an AI feature (a correct-enough answer within N seconds, not just HTTP 200). Then:

1. **Classify errors:** retry 429 (honoring `Retry-After`), 5xx and 529 with jittered backoff; never retry other 4xx errors or spend-cap 429s.
2. **Chain:** primary model → same model, other region → second provider → degraded path, all inside one request deadline.
3. **Protect:** circuit breaker or retry budget per backend; load-shed low-priority traffic.
4. **Detect:** error rate, latency percentiles, and canary-prompt quality scores per backend.
5. **Respond:** runbook, incident commander, status page.

Interviewers probe: *What if every user fails over at once?* (Reserved capacity, shedding.) *How do you know the fallback is good enough?* (Run the same eval suite on every model in the chain.) *Streaming failure halfway?* (Resume or regenerate; show a partial answer flag.) *How do you catch "worse, not broken"?* (Production quality evals.)

## 🧱 Builds on

- [[Fault Tolerance (Deep Dive)]] — timeouts, jittered backoff, circuit breakers and bulkheads, applied to model calls with long and variable latency.
- [[Rate Limiting (Deep Dive)]] — 429 semantics, `Retry-After`, and token buckets for both provider limits and retry budgets.
- [[Message Queues (Deep Dive)]] — queues, retries and dead-letter queues turn model outages into delays for non-interactive work.
- [[Replication (Deep Dive)]] — multi-region and multi-provider deployments are replication of the inference tier, with the same failover questions.

## Check yourself

> [!question]- Your fallback provider starts returning 429s the moment your primary goes down. Why, and what do you do?
> Many customers failed over at once, or your normal traffic exceeds the backup's rate limit because you only ever sent it test traffic. Reserve or pre-negotiate capacity on the fallback, keep it warm with a share of real traffic, and shed low-priority requests during failover.

> [!question]- Error rates and latency are normal, but user complaints spike. What could be happening?
> A silent quality regression: a routing, hardware or sampling bug degrading outputs. Check production quality evals and canary prompts per backend, and compare complaint timing with recent deploys or load-balancing changes.

> [!question]- Why retry at only one layer of the stack?
> Retries multiply across layers. Three retries at each of five layers can multiply load on the bottom dependency by 243×, keeping it overloaded long after the original fault.

## Further reading

- 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — the best short essay on retrying without making things worse.
- 📄 [API, ChatGPT & Sora Facing Issues (write-up)](https://status.openai.com/incidents/ctrsv3lwd797/write-up) — a candid AI-provider outage write-up with concrete remediations.
- 📝 [A postmortem of three recent issues](https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues) — rare detail on silent quality bugs in LLM serving.
- 📘 [Managing Incidents](https://sre.google/sre-book/managing-incidents/) — the incident-command model most teams copy.
- 📄 [Fallbacks (Provider Failover)](https://docs.litellm.ai/docs/proxy/reliability) — a working config for retries, fallbacks and cooldowns.

## Related

- [[AI Monitoring & Observability (Deep Dive)]] — the signals that trigger failover and catch quality drift.
- [[Deployment & Serving (Deep Dive)]] — replicas, rollouts and canaries for model servers.
- [[Evaluation & Metrics (Deep Dive)]] — production evals that detect "worse, not broken."
- [[AI Scalability & Distributed Systems (Deep Dive)]] — training-cluster failures and checkpointing at scale.
- [[Cost Optimization (Deep Dive)]] — spare capacity and spot instances trade cost against resilience.

> [!nav] Keep going
> ← [[Cost Optimization (Deep Dive)|Cost Optimization]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Ethics & Governance (Deep Dive)|Ethics & Governance]] →
> 🌱 Back to the basics: [[AI Reliability & Fault Tolerance]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Claude API errors](https://platform.claude.com/docs/en/api/errors) — Anthropic, Claude Platform docs. Official docs. Checked 2026-11.
[^2]: 📄 [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) — OpenAI API docs. Official docs. Checked 2026-11.
[^3]: 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — Amazon Builders' Library, AWS. Engineering blog. Checked 2026-11.
[^4]: 📄 [Fallbacks (Provider Failover)](https://docs.litellm.ai/docs/proxy/reliability) — LiteLLM documentation. Official docs. Checked 2026-11.
[^5]: 📄 [Route model inference requests across AWS Regions with cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) — Amazon Bedrock User Guide. Official docs. Checked 2026-11.
[^6]: 📝 [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html) — Martin Fowler. Article. Checked 2026-11.
[^7]: 📝 [A postmortem of three recent issues](https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues) — Anthropic Engineering. Engineering blog. Checked 2026-11.
[^8]: 🔬 [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783) — Llama Team, Meta AI, 2024. Paper. Checked 2026-11.
[^9]: 📘 [Managing Incidents](https://sre.google/sre-book/managing-incidents/) — Site Reliability Engineering, Google (O'Reilly). Book. Checked 2026-11.
[^10]: 📄 [API, ChatGPT & Sora Facing Issues (write-up)](https://status.openai.com/incidents/ctrsv3lwd797/write-up) — OpenAI Status. Official postmortem. Checked 2026-11.
