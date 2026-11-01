---
aliases: [Fault Tolerance deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/reliability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Reliability]]"
basics: "[[Fault Tolerance]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Reliability]] › [[Fault Tolerance]] › 🔬 Deep Dive

> [!tldr] For engineers
> Fault tolerance is **redundancy plus containment**. Redundancy, ideally pre-provisioned, absorbs crash faults; containment (timeouts, bounded retries with jittered backoff, circuit breakers, bulkheads, load shedding) stops a slow or overloaded dependency from cascading. Size it against an SLO and its error budget, and prove it by injecting faults in production.

> [!basics]- New to this? Start with the basics
> [[Fault Tolerance]] explains it with no jargon.

## How it really works

Crash faults are the easy case: a dead host fails health checks and traffic moves elsewhere. The dangerous faults are **slow** and **overloaded** dependencies, because callers keep waiting, hold resources and add retries. Most of the toolkit exists to bound that waiting.

### Timeouts and deadlines

Every remote call needs a connection and a request timeout.[^1] One method from the Amazon Builders' Library: decide what rate of false timeouts you accept (their example is 0.1%), then set the timeout at the matching latency percentile of the dependency, p99.9 in that case.[^1] Pad it when p99.9 sits close to p50 or when clients have high network latency.[^1]

Inside a call graph, pass a **deadline** rather than a fresh timeout per hop. Google's example: a 30-second deadline with 7 seconds already spent leaves 23 seconds for the next RPC, minus a few hundred milliseconds of margin.[^2]

### Retries, backoff and jitter

Retries handle transient faults but are "selfish": the client spends more of the server's capacity to raise its own odds.[^1] Three rules keep them safe:

1. **Back off exponentially, with a cap, and add jitter.** In Marc Brooker's simulation of 100 contending clients, jitter cut the number of calls by more than half versus plain exponential backoff, and unjittered backoff did the most work and took the longest.[^3]
2. **Retry at one layer only.** If five layers each retry three times, load on the database grows 243x.[^1] Google's version: four attempts at each of three layers gives 64 attempts on the backend.[^2]
3. **Budget retries.** Google caps each request at three attempts and only retries while a client's retry ratio stays under 10%, which keeps load growth around 1.1x in the general case, versus nearly 3x without the client-level budget.[^4] The AWS SDKs added a token bucket for retries in 2016: retries spend tokens, and once empty they fall back to a fixed rate.[^1]

Only retry operations that are **idempotent**, where side effects happen once however many times the request arrives.[^1]

A common full-jitter loop:

```python
def call_with_retries(op, attempts=3, base=0.1, cap=5.0):
    for attempt in range(attempts):
        try:
            return op(timeout=deadline_remaining())
        except TransientError:
            if attempt == attempts - 1 or not retry_budget.take():
                raise
            sleep(random.uniform(0, min(cap, base * 2 ** attempt)))
```

### Circuit breakers

A **circuit breaker** wraps a remote call and counts failures; past a threshold it trips and returns errors without calling the dependency.[^5] **Closed** passes calls; **open** fails them fast; after a reset interval it goes **half-open** and lets a trial call through, closing on success and re-opening on failure.[^5] The basic version trips on consecutive failures; production versions trip on a failure rate and set thresholds per error type.[^5]

Hystrix trips only when request volume in the window exceeds a minimum *and* the error percentage exceeds a threshold, then lets a single request through after a sleep window.[^6] Resilience4j, which Netflix now recommends instead,[^7] defaults to a 50% failure-rate threshold over a 100-call sliding window, needs at least 100 calls before it judges, and treats calls over 60 seconds as slow.[^8] It also allows 10 trial calls in half-open.[^8]

### Bulkheads

A **bulkhead** gives each dependency its own bounded resource pool. Hystrix ran each dependency in its own thread pool so that latency "will saturate the available threads only in that pool", at the cost of extra computational overhead.[^6]

### Load shedding and graceful degradation

When in-flight work exceeds a limit, reject early with HTTP 503 rather than queueing.[^2] Keep queues small relative to the thread pool (50% or less for steady traffic), and consider LIFO or CoDel queueing so you serve requests whose callers are still waiting.[^2] Tag traffic by criticality: Google uses `CRITICAL_PLUS`, `CRITICAL`, `SHEDDABLE_PLUS` and `SHEDDABLE`, and must provision for all critical traffic.[^4] Rejection is not free: at enough scale, a backend can be overloaded just rejecting requests.[^4]

**Graceful degradation** turns hard dependencies into soft ones: serve stale, partial or default data instead of an error page.[^9] AWS adds a warning: fallback paths must be tested and much simpler than the main path, and complex fallback strategies should generally be avoided.[^9]

### Redundancy and static stability

Plain redundancy that waits to launch replacements during an outage depends on a control plane exactly when it is most stressed. Amazon prefers **static stability**: "the overall system keeps working even when a dependency becomes impaired."[^10] Services spread over three Availability Zones are overprovisioned by 50%, so each zone runs at about two-thirds of its load-tested capacity and losing one needs no new instances.[^10]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Short timeout | Frees resources fast; quick failover | False timeouts on slow-but-healthy calls |
| Retries with backoff and jitter | Masks transient faults | Amplifies load; needs idempotency |
| Retry budget / token bucket | Bounds amplification | Some recoverable requests fail |
| Circuit breaker | Fails fast; gives the dependency room | Tuning; can flap; per-host view only |
| Bulkhead pools | One slow dependency can't starve the rest | Thread overhead; idle capacity[^6] |
| Load shedding | Keeps goodput under overload | Rejected users; rejection still costs CPU[^4] |
| Fallback data | Users still get something | Rarely exercised path; can hide outages[^9] |
| Static stability (N+1 zones) | No control-plane dependency in recovery | 50% extra capacity; each zone runs at ~two-thirds load[^10] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Downtime allowed by 99.99% availability | 52.56 minutes per year[^11] |
| Cost of each additional nine | Can be 100x the previous increment[^11] |
| Retry amplification, 5 layers x 3 retries | 243x[^1] |
| Retry amplification, 3 layers x 4 attempts | 64x[^2] |
| Google retry budget | 3 attempts per request; retry ratio below 10% per client; about 1.1x load growth in general[^4] |
| Timeout from latency | 0.1% false timeouts implies the p99.9 latency[^1] |
| Adaptive throttling multiplier | K = 2 preferred: clients send until requests reach 2x accepts[^4] |
| Static stability overprovisioning, 3 zones | 50%[^10] |
| Resilience4j breaker defaults | 50% failure rate, 100-call window, 10 half-open calls[^8] |

## Failure modes

- **Retry storms.** A brief blip triggers synchronized retries at several layers, multiplying load until the dependency cannot recover. Defend with single-layer retries, budgets and jitter.[^1][^4]
- **Cascading overload.** Losing one cluster pushes its load onto the next; in Google's example, cluster A's load rises from 1,000 to 1,200 QPS and its frontends crash.[^2] Shed load early and keep headroom.
- **Crash loops that won't clear.** Servers crash as they come up because they get full traffic at once. In Google's example, cutting load from 11,000 to 9,000 QPS may not be enough; recovery might need about 1,000 QPS.[^2] Ramp traffic gradually.
- **Resource exhaustion.** Slow calls pin threads, memory and file descriptors; a CPU-starved Java process can enter a GC death spiral.[^2] Timeouts and bulkheads cap the blast radius.
- **Untested fallbacks.** The degraded path runs once a year and fails when needed.[^9] Exercise it continuously.
- **Recovery that needs the control plane.** Launching replacements during a zonal event depends on APIs under stress.[^10] Pre-provision.
- **Non-critical load during an incident.** Index rebuilds and statistics jobs compete with user traffic; turn them off.[^2]

## In the real world

- **Netflix Chaos Monkey** randomly terminates production instances so engineers must build services that survive instance loss.[^12]
- **Netflix Hystrix** popularized breakers, bulkheads and fallbacks on the JVM; it is now in maintenance mode, and Netflix points new projects to Resilience4j.[^7]
- **Amazon** documents static stability across Availability Zones as a core design rule.[^10] A 2023 update to Brooker's jitter post notes that most AWS SDKs now support exponential backoff with jitter.[^3]
- **Google SRE** ties all of this to an **error budget**: a 99.999% SLO leaves 0.001% unreliability per quarter to spend on launches and risk.[^11]

## In a design interview

State the availability target first, then walk the request path:

1. **Target:** "99.95% for checkout; recommendations can degrade."
2. **Redundancy:** "Stateless app tier in three zones with 50% headroom; database with a synchronous standby."
3. **Containment:** "Deadlines propagated from the edge; retries only at the client SDK, three attempts, jittered, with a budget; a breaker around recommendations that falls back to a cached popular list."
4. **Overload:** "Shed sheddable traffic at the load balancer with 503 before it reaches the app."
5. **Proof:** "Fault injection in staging and production; dashboards and alerts on error rate and latency."

Interviewers probe: *Where exactly do you retry?* *What if the fallback store is also down?* *How does a breaker behave across 200 hosts?* (Each host trips on its own view, so recovery is gradual.) *How do you know it works?* (Chaos testing.)

## Check yourself

> [!question]- Three services call each other in a chain, each retrying failed calls twice (three attempts). The bottom service blips. What load can it see?
> Up to 3 x 3 x 3 = 27 times normal. Retry at one layer only and add a retry budget to keep amplification small.

> [!question]- Why does Google suggest LIFO or CoDel queues under overload?
> In FIFO, the oldest requests are served first, but their callers have probably timed out already, so the work is wasted. Serving the newest first spends capacity on requests that can still succeed.

> [!question]- Why is "launch replacement instances when a zone fails" weaker than static stability?
> Recovery then depends on the control plane at the moment it is most stressed. Pre-provisioned spare capacity in the surviving zones needs nothing new to start.

## Further reading

- 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — the best practical guide to retries, from the team that runs AWS.
- 📝 [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — the simulation that made jitter standard practice.
- 📘 [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — causes, defenses and worked examples from Google SRE.
- 📝 [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html) — the canonical short description of the pattern.
- 📝 [Static stability using Availability Zones](https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones) — why pre-provisioned capacity beats reactive recovery.

## Related

- [[Load Balancing (Deep Dive)]] — health checks and routing around dead hosts.
- [[Replication (Deep Dive)]] — redundancy for data, and failover.
- [[Message Queues (Deep Dive)]] — buffering work and dead-letter queues.
- [[Rate Limiting (Deep Dive)]] — admission control that prevents overload.
- [[Metrics (Deep Dive)]] — SLOs and the signals that trip breakers.
- [[AI Reliability & Fault Tolerance (Deep Dive)]] — fallbacks and retries for model providers.

> [!nav] Keep going
> ← [[Message Queues (Deep Dive)|Message Queues]] · [[Reliability|🛡️ Reliability]] · [[Rate Limiting (Deep Dive)|Rate Limiting]] →
> 🌱 Back to the basics: [[Fault Tolerance]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — Marc Brooker, Amazon Builders' Library, 2019. Engineering blog. Checked 2026-11.
[^2]: 📘 [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — Site Reliability Engineering, Google (O'Reilly). Book chapter. Checked 2026-11.
[^3]: 📝 [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog, 2015 (updated 2023). Engineering blog. Checked 2026-11.
[^4]: 📘 [Handling Overload](https://sre.google/sre-book/handling-overload/) — Site Reliability Engineering, Google (O'Reilly). Book chapter. Checked 2026-11.
[^5]: 📝 [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html) — Martin Fowler, 2014. Article. Checked 2026-11.
[^6]: 📄 [How it Works](https://github.com/Netflix/Hystrix/wiki/How-it-Works) — Netflix Hystrix wiki, GitHub. Official docs. Checked 2026-11.
[^7]: 📄 [Hystrix README](https://github.com/Netflix/Hystrix) — Netflix, GitHub. Official docs. Checked 2026-11.
[^8]: 📄 [CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker) — Resilience4j documentation. Official docs. Checked 2026-11.
[^9]: 📄 [REL05-BP01 Implement graceful degradation](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html) — AWS Well-Architected Framework, Reliability Pillar. Official docs. Checked 2026-11.
[^10]: 📝 [Static stability using Availability Zones](https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones) — Mike Furr, Amazon Builders' Library, 2019. Engineering blog. Checked 2026-11.
[^11]: 📘 [Embracing Risk](https://sre.google/sre-book/embracing-risk/) — Site Reliability Engineering, Google (O'Reilly). Book chapter. Checked 2026-11.
[^12]: 📄 [Chaos Monkey](https://netflix.github.io/chaosmonkey/) — Netflix. Official docs. Checked 2026-11.
