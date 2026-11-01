---
aliases: [Microservices deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/architecture-styles]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Architecture Styles]]"
basics: "[[Microservices]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Architecture Styles]] › [[Microservices]] › 🔬 Deep Dive

> [!tldr] For engineers
> Microservices are **independently deployable services, each owning its data**, organized around business capabilities. You buy team autonomy, per-service scaling and fault isolation, and you pay with **distribution**: remote calls that are slow and can fail, eventual consistency instead of local transactions, and a heavy operational platform. The style only pays off past a complexity threshold, and it fails worst when boundaries are wrong.

> [!basics]- New to this? Start with the basics
> [[Microservices]] explains it with no jargon.

## How it really works

Lewis and Fowler define the style as building one application as **a suite of small services**, each running in its own process, communicating through lightweight mechanisms such as HTTP APIs, built around business capabilities and independently deployable by automated machinery.[^1] Their nine characteristics are the practical checklist:[^1]

1. **Componentization via services:** components are out-of-process, so they can be replaced and upgraded independently.
2. **Organized around business capabilities:** cross-functional teams own a capability end to end, not a technical layer.
3. **Products, not projects:** the team that builds a service runs it for its lifetime.
4. **Smart endpoints, dumb pipes:** logic lives in services; the transport stays simple.
5. **Decentralized governance:** teams choose their own tools.
6. **Decentralized data management:** each service owns its store; consistency is often eventual.
7. **Infrastructure automation:** CI/CD and automated testing are prerequisites.
8. **Design for failure:** every caller must tolerate a dependency being down.
9. **Evolutionary design:** services are replaced rather than patched forever.

The article also cites **Conway's law**: a system's design tends to copy the communication structure of the organization that builds it.[^1] Microservices use that deliberately, aligning one team with one service.

### Data: database per service and sagas

If each service owns its database, a business transaction that spans services cannot be one local ACID transaction, and two-phase commit is ruled out.[^2] The standard answer is a **saga**: a coordinated sequence of local transactions.[^2] It comes in two flavors:[^2]

- **Choreography:** each local transaction publishes an event that triggers the next service.
- **Orchestration:** a coordinator tells each participant which step to run.

A saga has no automatic rollback. Developers write **compensating transactions** that undo earlier steps, and sagas lack isolation, so concurrent sagas can see each other's intermediate data.[^2]

### Calls: timeouts, retries, backoff, jitter

Every network hop needs a timeout, because slow requests hold threads, connections and memory.[^3] Retries look free but amplify load. AWS's Builders' Library gives the classic example: in a five-layer call stack where each layer retries three times, load on the bottom database rises **243x**.[^3] The defenses:[^3]

- Retry at **one layer** of the stack, not every layer.
- Use **exponential backoff with jitter** so clients that failed together don't retry together.
- Cap retries with a local **token bucket**.
- Retry only **idempotent** operations, or give mutating APIs an idempotency token.

```python
import random, time

def call_with_retry(request, attempts=3, base=0.1, cap=2.0):
    for attempt in range(attempts):
        try:
            return client.send(request, timeout=0.5)  # always set a timeout
        except TransientError:
            if attempt == attempts - 1:
                raise
            # "full jitter": random sleep up to the exponential ceiling
            time.sleep(random.uniform(0, min(cap, base * 2 ** attempt)))
```

### Edge: the API gateway

Clients should not know how the backend is split. An **API gateway** is the single entry point: it routes some requests straight through, fans out and composes others, translates protocols and checks authorization.[^4] The **Backends for Frontends** variant gives each client type, such as web or mobile, its own gateway.[^4] The cost is one more component and one more hop.[^4]

### Service mesh

Cross-cutting network concerns can move out of application code. Istio intercepts traffic with a proxy: in **sidecar mode** an Envoy proxy runs beside each pod; in **ambient mode** a per-node Layer 4 proxy handles traffic, with optional per-namespace Envoy proxies for Layer 7 features.[^5] A **control plane** turns configuration into proxy rules; the **data plane** carries service-to-service traffic.[^5] In return you get mutual TLS, retries, failover, fault injection, load balancing and automatic metrics, logs and traces.[^5]

### SOA versus microservices

**Service-oriented architecture** dates from the late 1990s and is an **enterprise-wide integration style**, often built around an **enterprise service bus** that handles routing, transformation and protocol conversion centrally.[^6] Microservices are **application-scoped**: they split one application's internals into independently changed, scaled and deployed pieces.[^6] Lewis and Fowler note that some call microservices "service orientation done right", while others reject the SOA label because of its heavyweight ESB baggage.[^1]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Microservices vs monolith | Strong module boundaries, independent deploys, technology diversity[^7] | Slow, failure-prone remote calls; eventual consistency; operational complexity[^7] |
| Synchronous calls (REST, gRPC) | Simple request/response reasoning | Temporal coupling; latency stacks up along the call chain |
| Asynchronous events | Producers and consumers decouple in time | Harder debugging; ordering and duplicate handling |
| Choreographed saga | No central coordinator | Flow is implicit and hard to trace |
| Orchestrated saga | Explicit, testable flow | Orchestrator becomes a hotspot |
| Sidecar mesh | Uniform mTLS, retries and telemetry | A proxy per pod: extra hop, memory and ops |
| Fine vs coarse services | Finer: more independence | Finer: more hops, more data handoffs, higher bills[^8] |

Fowler's summary of the economics: microservices **impose a cost on productivity** that only more complex systems make back.[^7] He lists team size, multi-tenancy, independently evolving business functions and scale as the drivers that justify it.[^9]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Uber critical microservices (2020) | About 2,200, grouped into 70 domains[^10] |
| Services touched by one Uber root-cause investigation | About 50, owned by 12 teams[^10] |
| Uber estimated half-life of a microservice | 1.5 years[^10] |
| Uber feature integration with domain extensions | 3 days down to 3 hours[^10] |
| Load amplification, 5 layers x 3 retries | 243x on the database[^3] |
| Netflix migration, monolith to hundreds of services | 2008 to early 2016[^11] |
| Netflix availability after migration | Approaching four nines (99.99%)[^11] |
| Prime Video monitoring on fine-grained serverless steps | Reached only about 5% of expected load[^8] |

## Failure modes

- **Cascading failure.** One slow dependency exhausts callers' threads, which then fail their own callers. Defend with timeouts, bulkheads and circuit breakers; Lewis and Fowler list design for failure and monitoring as core traits.[^1]
- **Retry storms.** Layered retries multiply load exactly when a service is weakest. Retry at one layer, with backoff, jitter and a retry budget.[^3]
- **Distributed monolith.** Services that must deploy together give you the costs of both styles. Uber calls these "networked monoliths".[^10]
- **Debugging sprawl.** One incident spanning dozens of services and teams. Defend with [[Distributed Tracing (Deep Dive)|distributed tracing]] and clear domain ownership; Uber added domain gateways and layering to limit blast radius.[^10]
- **Data anomalies.** Sagas lack isolation, so concurrent flows can read half-finished state.[^2] Defend with semantic locks, versioning or reordering steps.
- **Too fine-grained.** Prime Video's monitoring pipeline hit account limits on Step Functions state transitions and high S3 costs passing frames between steps; consolidating into one process cut costs 90%.[^8]

## In the real world

- **Netflix** rebuilt nearly everything as cloud-native microservices after a 2008 database corruption, and uses production failure drills to keep services resilient.[^11]
- **Uber** introduced Domain-Oriented Microservice Architecture (DOMA): domains of related services, five dependency layers, one gateway per domain and extension points instead of cross-domain edits.[^10]
- **Amazon** popularized "you build it, you run it" ownership,[^1] and its guidance describes small **two-pizza teams** owning services from creation through maintenance.[^12]
- **Istio** with Envoy is a widely used open-source service mesh.[^5]

## In a design interview

Justify the split before drawing boxes.

1. **Why services:** "Separate teams for catalog, checkout and search; search scales 10x the rest."
2. **Boundaries:** "Split by business capability; each service owns its tables; no shared database."
3. **Communication:** "gRPC for synchronous reads behind a gateway; events on a queue for order-placed and payment-captured."
4. **Consistency:** "Checkout is an orchestrated saga: reserve stock, charge card, confirm; compensations release stock or refund."
5. **Resilience:** "Timeouts everywhere, retries only at the edge with jittered backoff, idempotency keys on payments."

Interviewers probe: *How do you trace a request?* (Propagated trace IDs.) *What if payments is down?* (Queue the step, degrade gracefully.) *Why not a monolith?* (Have a real answer, or admit one would do.)

## Check yourself

> [!question]- Why does a five-layer stack with three retries per layer produce 243x load?
> Each layer makes up to three attempts on the layer below, so attempts multiply: 3 to the fifth power is 243 calls at the bottom for one top-level request.

> [!question]- When would you pick an orchestrated saga over choreography?
> When the flow has many steps or compensations and you need it explicit, testable and observable in one place. Choreography suits short flows where a central coordinator adds little.

> [!question]- How does a service mesh change where retry logic lives?
> It moves retries, timeouts, mTLS and telemetry from each service's code into proxies configured by a control plane, so policy is uniform across languages. You still must make operations idempotent.

## Further reading

- 📝 [Microservices](https://martinfowler.com/articles/microservices.html) — the 2014 article that named the style and its nine characteristics.
- 📝 [Introducing Domain-Oriented Microservice Architecture](https://www.uber.com/blog/microservice-architecture/) — how Uber tamed 2,200 services.
- 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — Amazon's hard-won rules for calling other services.
- 📝 [Pattern: Saga](https://microservices.io/patterns/data/saga.html) — the standard answer to cross-service transactions.
- 📄 [What is Istio?](https://istio.io/latest/docs/overview/what-is-istio/) — sidecar and ambient service mesh, explained by the project.

## Related

- [[Monoliths (Deep Dive)]] — the alternative, and where most services come from.
- [[Serverless (Deep Dive)]] — functions as the unit of deployment.
- [[gRPC (Deep Dive)]] — a common protocol for service-to-service calls.
- [[Message Queues (Deep Dive)]] — asynchronous events between services.
- [[Fault Tolerance (Deep Dive)]] — circuit breakers, bulkheads and graceful degradation.
- [[AI Scalability & Distributed Systems (Deep Dive)]] — the same distribution trade-offs in AI platforms.

> [!nav] Keep going
> ← [[Monoliths (Deep Dive)|Monoliths]] · [[Architecture Styles|🧱 Architecture Styles]] · [[Serverless (Deep Dive)|Serverless]] →
> 🌱 Back to the basics: [[Microservices]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Microservices](https://martinfowler.com/articles/microservices.html) — James Lewis and Martin Fowler, 2014. Article. Checked 2026-11.
[^2]: 📝 [Pattern: Saga](https://microservices.io/patterns/data/saga.html) — Chris Richardson, microservices.io. Article. Checked 2026-11.
[^3]: 📝 [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) — Amazon Builders' Library, AWS. Engineering blog. Checked 2026-11.
[^4]: 📝 [Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html) — Chris Richardson, microservices.io. Article. Checked 2026-11.
[^5]: 📄 [What is Istio?](https://istio.io/latest/docs/overview/what-is-istio/) — Istio documentation. Official docs. Checked 2026-11.
[^6]: 📄 [What is service-oriented architecture (SOA)?](https://www.ibm.com/think/topics/soa) — IBM. Official docs. Checked 2026-11.
[^7]: 📝 [Microservice Trade-Offs](https://martinfowler.com/articles/microservice-trade-offs.html) — Martin Fowler, 2015. Article. Checked 2026-11.
[^8]: 📝 [Prime Video Switched from Serverless to EC2 and ECS to Save Costs](https://infoq.com/news/2023/05/prime-ec2-ecs-saves-costs) — Rafał Gancarz, InfoQ, 2023. Article. Checked 2026-11.
[^9]: 📝 [MicroservicePremium](https://martinfowler.com/bliki/MicroservicePremium.html) — Martin Fowler, 2015. Article. Checked 2026-11.
[^10]: 📝 [Introducing Domain-Oriented Microservice Architecture](https://www.uber.com/blog/microservice-architecture/) — Adam Gluck, Uber Engineering, 2020. Engineering blog. Checked 2026-11.
[^11]: 📝 [Completing the Netflix Cloud Migration](https://about.netflix.com/en/news/completing-the-netflix-cloud-migration) — Netflix, 2016. Engineering blog. Checked 2026-11.
[^12]: 📄 [Implementing Microservices on AWS](https://docs.aws.amazon.com/whitepapers/latest/microservices-on-aws/microservices-on-aws.html) — Amazon Web Services whitepaper, 2023. Official docs. Checked 2026-11.
