---
aliases: [Monoliths deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/architecture-styles]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Architecture Styles]]"
basics: "[[Monoliths]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Architecture Styles]] › [[Monoliths]] › 🔬 Deep Dive

> [!tldr] For engineers
> A monolith is **one deployable unit over one database**: in-process calls, local ACID transactions, one pipeline. It scales horizontally by cloning and by sharding data, not by function. Its real limit is organizational: coupling and coordination costs grow with team size, which a **modular monolith** attacks with enforced internal boundaries before anyone pays the network tax of [[Microservices (Deep Dive)|microservices]].

> [!basics]- New to this? Start with the basics
> [[Monoliths]] explains it with no jargon.

## How it really works

The monolithic pattern structures an application as **a single deployable or executable component that uses a single database**, with every subdomain inside it.[^1] Three properties follow directly:

- **Calls are local.** A module calls another through a function call, not an RPC, so there is no serialization, no network latency and no partial failure between them.[^1]
- **Transactions are local.** Because all state lives in one database, a cross-domain operation can usually be a single ACID transaction.[^1]
- **Releases are atomic.** One build, one test suite, one artifact. Every deploy ships everything.[^2]

```python
def place_order(cart, card):  # one process, one database: all or nothing
    with db.transaction():
        order = orders.create(cart)          # orders module
        inventory.reserve(order.items)       # inventory module
        payments.charge(card, order.total)   # payments module
    return order
```

In a distributed design, the same flow spans three services and needs a saga with compensating steps instead of one `COMMIT`. That gap is the core of the [[Trade-offs (Deep Dive)|trade-off]].

### How a monolith scales

The **scale cube** from *The Art of Scalability* names three axes.[^3]

- **X-axis: clone it.** Run identical copies behind a [[Load Balancing (Deep Dive)|load balancer]]. Each copy can reach all the data, so caches need more memory to stay effective.[^3]
- **Z-axis: partition the data.** Identical code, but each server owns a subset of the data, routed by a key such as customer ID. This is how [[Sharding (Deep Dive)|sharding]] works.[^3]
- **Y-axis: split by function.** Break the app into services, each owning related functions. Microservices are an application of this axis.[^3]

A monolith gets X and Z. It cannot do Y without ceasing to be a monolith, so a hot feature forces you to scale the whole application.[^4]

### The modular monolith

The weakness of a large monolith is not the single process; it is **missing internal boundaries**. Shopify's Rails codebase had no boundaries between business processes, which produced cascading test failures, slow CI and steep onboarding.[^2] Its fix kept one deployable but changed the inside:

1. **Organize by domain, not by layer.** Code moved from `models/`, `views/`, `controllers/` into real-world components such as orders, shipping, inventory and billing.[^2]
2. **Measure violations.** The first tool, Wedge, traced method calls during CI to build a call graph. It was noisy and took over an hour.[^5]
3. **Enforce statically.** Its replacement, Packwerk, analyzes constant references in minutes and blocks pull requests that cross a boundary without a declared dependency.[^5]
4. **Favor cohesion, not just decoupling.** Shopify's later lesson was that loose coupling must pair with high cohesion, and that encapsulation must be balanced against a simple dependency graph.[^5]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Plain monolith | Fastest to build; one pipeline; local ACID | Coupling grows unchecked; whole-app scaling and deploys |
| Modular monolith | Clear ownership; boundaries without a network hop | Needs tooling and discipline to enforce |
| Microservices | Independent deploy and scaling per service | Network latency, partial failure, eventual consistency[^6] |
| Package by layer | Familiar framework defaults | One feature touches every folder; weak cohesion |
| Package by domain | Changes stay local to one component | Shared data and cross-domain queries need care[^5] |
| One shared schema | Simple joins and transactions | Any module can couple to any table |

Martin Fowler frames the decision as a **microservice premium**: distribution adds cost and risk that only pays off past a certain complexity, driven by team size, multi-tenancy, independently evolving business functions and scale.[^7] He also argues that a monolith is not incompatible with continuous delivery.[^7]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Shopify monolith size (2020) | 2.8M+ lines of Ruby, ~500,000 commits[^5] |
| Shopify components in the main monolith (2020) | 37; Packwerk on about a third of them[^5] |
| Shopify contributors over the codebase's life | More than 1,000 developers[^2] |
| Wedge vs Packwerk run time | Over an hour vs a few minutes[^5] |
| Stack Overflow daily load (Feb 2016) | 209M HTTP requests, 66M page loads, 504M SQL queries[^8] |
| Stack Overflow web tier | 9 primary IIS web servers; question page render 22.71 ms average[^8] |
| Prime Video monitoring, distributed version | Handled about 5% of expected load[^9] |
| Prime Video after consolidating into one process | 90% lower operating cost[^9] |

Stack Overflow's multi-tenant Q&A application could serve the entire network from **a single application pool on one server**.[^8] One well-built process goes a long way.

## Failure modes

- **Big ball of mud.** Without boundaries, unrelated changes break each other's tests and every developer needs the whole system in their head.[^2] Defend with domain components and automated boundary checks.[^5]
- **Slow pipeline.** One large application means long builds and test runs, which slows every deploy.[^1] Defend with test selection per component and isolated component suites, which Shopify set as a long-term goal.[^5]
- **Shared blast radius.** A memory leak or crash in one feature takes the whole process down, because nothing isolates it. Independent services limit that blast radius at the price of distribution.[^6]
- **Whole-app scaling waste.** A single hot function forces you to scale every function.[^4] Defend by caching, sharding data, or extracting only that hot path.
- **Technology lock.** One stack must fit every subdomain, and upgrading the framework touches everything.[^1] Shopify mitigates this by running its monolith on unreleased Rails revisions, made manageable by clear ownership.[^5]
- **Premature split.** Teams that start with microservices often guess wrong boundaries, and refactoring across services is far harder than inside one codebase.[^10]

## In the real world

- **Shopify** chose a modular monolith over microservices, citing per-service pipelines, infrastructure overhead and network unreliability as costs it did not want.[^2] It splits off services only for strong reasons such as storefront rendering and card vaulting.[^5]
- **Stack Overflow** served hundreds of millions of daily requests from a small fleet running one multi-tenant Q&A application in 2016.[^8]
- **Prime Video's** audio/video monitoring tool moved from Step Functions, Lambda and S3 to a single process on ECS, after hitting account limits on state transitions and high S3 costs.[^9]
- **Netflix** went the other way: it moved from a monolithic application to hundreds of microservices during its 2008-2016 cloud migration.[^11]

### Getting out: the Strangler Fig

When a monolith must be split, the safest path is incremental. The **Strangler Fig** pattern builds new functionality beside the legacy system, finds seams, and moves behavior piece by piece through transitional architecture until the old system can be retired.[^12]

## In a design interview

Start with a monolith unless the prompt forces otherwise, and say why.

1. **Default:** "One deployable over Postgres, organized by domain modules: users, catalog, orders, payments."
2. **Scale:** "Stateless app servers behind a load balancer; read replicas and caching; shard by customer ID if writes outgrow one primary."
3. **Evolution:** "If checkout needs independent scaling or a separate team, extract it behind its existing module interface."

Interviewers probe: *How do you deploy without downtime?* (Rolling deploys across clones.) *What if one feature is hot?* (Cache it, then extract it.) *When would you split?* (Team contention, divergent scaling needs, or isolation requirements such as PCI scope.)

## Check yourself

> [!question]- Why is a modular monolith often a better first move than microservices?
> It gives clear ownership and enforced boundaries while keeping in-process calls, one pipeline and local transactions. If boundaries prove stable, extraction later is cheaper because the seams already exist.

> [!question]- Which scale cube axes can a monolith use, and which can't it?
> X (cloning behind a load balancer) and Z (partitioning data by key). Y, splitting by function, turns it into services.

> [!question]- Prime Video cut costs by consolidating into one process. Does that prove monoliths are cheaper?
> No. It shows that fine-grained distribution with per-step orchestration and object-storage handoffs was expensive for that sustained, data-heavy workload. The lesson is to match granularity to the workload.

## Further reading

- 📝 [Under Deconstruction: The State of Shopify's Monolith](https://shopify.engineering/shopify-monolith) — candid lessons from running a modular monolith at scale.
- 📝 [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) — the short, influential case for starting with one deployable.
- 📝 [Pattern: Monolithic Architecture](https://microservices.io/patterns/monolithic.html) — a crisp list of benefits and drawbacks.
- 📝 [Stack Overflow: The Architecture - 2016 Edition](https://nickcraver.com/blog/2016/02/17/stack-overflow-the-architecture-2016-edition/) — real hardware and traffic numbers for a lean, high-traffic system.
- 📝 [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) — how to migrate away incrementally.

## Related

- [[Microservices (Deep Dive)]] — the Y-axis split and its costs.
- [[Serverless (Deep Dive)]] — finer still: functions billed per invocation.
- [[Load Balancing (Deep Dive)]] — X-axis scaling for stateless monolith clones.
- [[Sharding (Deep Dive)]] — Z-axis scaling of the shared database.
- [[Databases (Deep Dive)]] — the ACID transactions a single database makes easy.
- [[Deployment & Serving (Deep Dive)]] — the same packaging question for model servers.

> [!nav] Keep going
> ← [[Trade-offs (Deep Dive)|Trade-offs]] · [[Architecture Styles|🧱 Architecture Styles]] · [[Microservices (Deep Dive)|Microservices]] →
> 🌱 Back to the basics: [[Monoliths]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Pattern: Monolithic Architecture](https://microservices.io/patterns/monolithic.html) — Chris Richardson, microservices.io. Article. Checked 2026-11.
[^2]: 📝 [Deconstructing the Monolith: Designing Software that Maximizes Developer Productivity](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity) — Kirsten Westeinde, Shopify Engineering, 2019. Engineering blog. Checked 2026-11.
[^3]: 📝 [The Scale Cube](https://microservices.io/articles/scalecube.html) — Chris Richardson, microservices.io. Article. Checked 2026-11.
[^4]: 📄 [Monolithic vs Microservices - Difference Between Software Development Architectures](https://aws.amazon.com/compare/the-difference-between-monolithic-and-microservices-architecture/) — Amazon Web Services. Official docs. Checked 2026-11.
[^5]: 📝 [Under Deconstruction: The State of Shopify's Monolith](https://shopify.engineering/shopify-monolith) — Philip Müller, Shopify Engineering, 2020. Engineering blog. Checked 2026-11.
[^6]: 📝 [Microservice Trade-Offs](https://martinfowler.com/articles/microservice-trade-offs.html) — Martin Fowler, 2015. Article. Checked 2026-11.
[^7]: 📝 [MicroservicePremium](https://martinfowler.com/bliki/MicroservicePremium.html) — Martin Fowler, 2015. Article. Checked 2026-11.
[^8]: 📝 [Stack Overflow: The Architecture - 2016 Edition](https://nickcraver.com/blog/2016/02/17/stack-overflow-the-architecture-2016-edition/) — Nick Craver. Engineering blog. Checked 2026-11.
[^9]: 📝 [Prime Video Switched from Serverless to EC2 and ECS to Save Costs](https://infoq.com/news/2023/05/prime-ec2-ecs-saves-costs) — Rafał Gancarz, InfoQ, 2023. Article. Checked 2026-11.
[^10]: 📝 [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) — Martin Fowler, 2015. Article. Checked 2026-11.
[^11]: 📝 [Completing the Netflix Cloud Migration](https://about.netflix.com/en/news/completing-the-netflix-cloud-migration) — Netflix, 2016. Engineering blog. Checked 2026-11.
[^12]: 📝 [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) — Martin Fowler. Article. Checked 2026-11.
