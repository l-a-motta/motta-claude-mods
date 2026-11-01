---
aliases: [Requirements deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/design-basics]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Design Basics]]"
basics: "[[Requirements]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Design Basics]] › [[Requirements]] › 🔬 Deep Dive

> [!tldr] For engineers
> Requirements turn an open-ended prompt into a bounded problem: **functional requirements** (behaviors and APIs), **non-functional requirements** (quality attributes with numeric targets) and explicit **scope**. Non-functional requirements drive the architecture, so state them as SLIs with percentile-based SLOs, keep any external SLA looser than the internal SLO, and spend the gap as an error budget.

> [!basics]- New to this? Start with the basics
> [[Requirements]] explains it with no jargon.

## How it really works

### Functional, non-functional, constraints

A functional requirement has the form "the system shall *do* X"; a non-functional one has the form "the system shall *be* Y".[^1] NFRs go by many names (quality attributes, "-ilities", cross-functional requirements) and split into **execution qualities** visible at run time, such as security and usability, and **evolution qualities** baked into the structure, such as testability, maintainability and scalability.[^1] They are usually architecturally significant: two systems with identical features but different NFRs end up with different architectures.[^1] Interview frameworks make the same split: opening questions should surface both kinds, plus what is out of scope.[^2]

Functional requirements are best captured as a short list of user-facing operations, often sketched as an API:

```text
POST /posts            create a post (text, optional media)
GET  /feed?cursor=...  friends' posts, reverse chronological
```

**Scope** and **constraints** complete the picture: what is explicitly out (ranking, ads, search), which platforms (web, mobile), and which existing systems or stack must be reused. ByteByteGo's interview framework spends the first 3–10 minutes of a 45-minute session here, asking about features, user counts, growth at 3, 6 and 12 months, and the existing tech stack.[^3] Its news-feed example lands on mobile and web, posting plus a reverse-chronological feed, up to 5,000 friends per user, 10 million daily active users, and media attachments.[^3]

### From qualities to numbers: SLI, SLO, SLA

Google's SRE book gives the canonical definitions:[^4]

- **SLI**: a carefully defined quantitative measure of some aspect of the service, such as latency, error rate, throughput or availability.
- **SLO**: a target value or range for an SLI, in the form `SLI ≤ target` or `lower ≤ SLI ≤ upper`.
- **SLA**: a contract with users that includes consequences for meeting or missing the SLOs. If there is no explicit consequence, it is an SLO, not an SLA.

The SRE Workbook sharpens this. An **SLI specification** is the outcome users care about, independent of how it is measured; an **SLI implementation** is a concrete way to measure it (server logs, load balancer metrics, synthetic probes), each with different coverage and cost.[^5] It expresses every SLI as a ratio of good events to valid events, so 0% is all bad and 100% is all good.[^5] Recommended SLI types by component:[^5]

| Component | SLI types |
| --- | --- |
| Request-driven (APIs, web) | Availability, latency, quality (share served undegraded) |
| Pipeline (batch, streaming) | Freshness, correctness, coverage |
| Storage | Durability (share of written records that can be read back) |

The Workbook also recommends anchoring SLIs on **critical user journeys**, sequences of tasks core to the user's experience, such as search, add to cart and checkout in a shop.[^5]

```yaml
# One SLO, written down
sli:   "share of GET /feed requests answered in < 300 ms, measured at the load balancer"
slo:   "99% over a rolling 28 days"
owner: feed-team
policy: "budget exhausted -> freeze feature launches, fix reliability first"
```

### Percentiles, not averages

Latency is a distribution, and the mean hides its tail. In the SRE book's example, a typical request takes about 50 ms while 5% of requests are 20 times slower.[^4] Amazon reached the same conclusion while building Dynamo: SLAs stated as mean or median miss exactly the customers with long histories whose personalized pages need more work, so Amazon expresses and measures SLAs at the **99.9th percentile**. It chose 99.9 rather than a higher percentile after a cost-benefit analysis.[^6] A typical SLA for a Dynamo-backed service was a response within 300 ms for 99.9% of requests at a peak load of 500 requests per second.[^6]

Percentile targets matter more as fan-out grows. One Amazon page request typically called over 150 services, each needing its own performance contract.[^6] Dean and Barroso show why: if a server answers in 10 ms but has a one-second 99th percentile, a request that must wait for 100 such servers is slower than one second 63% of the time.[^7] So per-dependency SLOs have to be much tighter than the user-facing one.

### Availability and error budgets

Availability can be **time-based** (uptime over total time) or **aggregate** (successful requests over total requests). Google mostly uses the aggregate form over a rolling window.[^8] At a 99.99% target, a time-based system may be down 52.56 minutes a year; a request-based one serving 2.5 million requests a day may fail 250 of them daily.[^8]

The **error budget** is `1 − SLO`. A 99.999% SLO leaves a 0.001% budget, so an issue failing 0.0002% of queries spends a fifth of it.[^8] While budget remains, teams ship; when it runs out, they slow releases or add testing.[^8] The Workbook calls for a written **error budget policy**, agreed by product, development and SRE, listing actions such as freezing changes until the service is back within SLO.[^5]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| One more nine in the SLO | Fewer user-visible failures | Each increment may cost 100x the previous one; less time for features[^8] |
| Mean or median latency target | Easy to compute and explain | Hides the slow tail that heavy users hit[^4][^6] |
| 99.9th percentile target | Protects nearly every user | Costlier; Amazon stopped at 99.9 on cost-benefit grounds[^6] |
| Many SLOs | Broad coverage | Noise; the SRE book says keep as few as give good coverage[^4] |
| Internal SLO tighter than SLA | Early warning before penalties apply | Extra engineering to beat the public number[^9] |
| Time-based availability | Simple for a single system | Meaningless for a globally distributed service that is always partly up[^8] |
| Request-based availability | Matches what users experience | Needs request-level instrumentation[^8] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| 99.99% availability as yearly downtime | 52.56 minutes[^8] |
| 99% / 99.999% as yearly downtime | 3.65 days / 5.26 minutes[^10] |
| Google Compute Engine published availability target | 99.95%, "three and a half nines"[^4] |
| Example SLA vs internal SLO | 99.9% vs 99.95% per month[^9] |
| S3 Standard credits | 10% below 99.9%, 25% below 99%, 100% below 95% monthly uptime[^11] |
| Typical Dynamo-backed SLA | 99.9% of requests within 300 ms[^6] |
| Dynamo successful responses (no timeout) | 99.9995% of requests[^6] |
| Users slower than 1 s when fanning out to 100 servers with a 1 s p99 | 63%[^7] |
| Workbook example API SLOs | 97% availability; 90% < 450 ms; 99% < 900 ms[^5] |

## Failure modes

- **Unmeasurable requirements.** "Fast" and "scalable" can't be tested or traded off. Replace each with an SLI, a threshold and a window.
- **Copying current performance.** Adopting today's numbers as the SLO without reflection can lock a team into heroic efforts to sustain them.[^4]
- **Overachieving.** Google's Chubby lock service was so reliable that other teams took hard dependencies on it. SRE now injects a planned outage when a quarter passes without one, to flush those dependencies out.[^4]
- **Absolute requirements.** "Always available" or "infinitely scalable" are unrealistic and expensive.[^4]
- **SLOs nobody enforces.** Without an agreed error budget policy, a missed SLO changes nothing; the Workbook says to keep iterating on the SLOs until stakeholders agree to enforce them.[^5]
- **Scope creep and over-engineering.** Designing for features nobody asked for, or for scale nobody expects, burns time; ByteByteGo lists over-engineering among the classic red flags.[^3]
- **Static requirements.** Load grows. Asking for scale at 3, 6 and 12 months up front shows which parts of the design must stretch.[^3]

## In the real world

- **Google SRE** sets targets per service and audience: an enterprise Google Apps for Work service might have a 99.9% quarterly external target, while YouTube in its early growth phase deliberately ran a lower target to favor feature velocity.[^8]
- **Amazon Dynamo** was shaped by one requirement: customers must be able to add items to their shopping cart even while disks fail, network routes flap or whole data centers go down. That always-writeable requirement pushed conflict resolution to read time.[^6]
- **Amazon S3** publishes an SLA defined on 5-minute error-rate intervals, with service credits as the consequence.[^11]
- **Google Auxon** plans capacity from declared intent rather than machine counts, with the motto "Specify the requirements, not the implementation"; owners state goals such as N+2 redundancy per continent or 50 ms between frontends and backends.[^12]

## In a design interview

Spend the first few minutes here and write everything down.[^3]

1. **Functional:** "Users post text and photos; users see a reverse-chronological feed of friends. Out of scope: ranking, ads, search."
2. **Non-functional:** "Feed reads p99 < 300 ms; 99.9% availability; a post may take a few seconds to appear for friends (eventual consistency is fine)."
3. **Scale:** "10M DAU, up to 5,000 friends, media attached; plan for 10x in a year." These numbers feed [[Estimation (Deep Dive)|estimation]].

Interviewers probe: *Which requirement is hardest?* (Name it and design around it.) *Why p99 and not average?* (Tail and fan-out.) *What is the read/write ratio?* *What happens when the SLO is missed?* (Error budget.) *Which requirement would you relax first?* That last question is the bridge to [[Trade-offs (Deep Dive)|trade-offs]].

## Check yourself

> [!question]- Your API's mean latency is 80 ms and the SLO is "mean < 100 ms", yet users complain. What is likely wrong?
> The mean hides the tail. A small share of very slow requests, often for the heaviest users or for requests that fan out, can ruin experience while the mean looks fine. Restate the SLO at p99 or p99.9 and measure per dependency.

> [!question]- Why should a published SLA be looser than the internal SLO?
> The gap is a safety margin. Breaching the internal SLO triggers fixes before the external promise, and its financial penalties, is at risk.

> [!question]- A service has a 99.9% request-based SLO and serves 10 million requests a day. How many failures may it have daily, and what happens when the budget is spent?
> 0.1% of 10 million, so 10,000 failed requests a day. When the budget is exhausted, the error budget policy kicks in: slow or freeze launches and prioritize reliability work until the service is back within SLO.

## Further reading

- 📘 [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — the standard definitions of SLI, SLO and SLA, with practical advice on choosing targets.
- 📘 [Implementing SLOs](https://sre.google/workbook/implementing-slos/) — the hands-on sequel: SLI menus per component, a worked example and error budget policies.
- 📘 [Embracing Risk](https://sre.google/sre-book/embracing-risk/) — why 100% is the wrong target and how error budgets align product and ops.
- 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — section 2 is a model of requirements writing: availability, percentile SLAs and explicit assumptions.
- 🎓 [A Framework For System Design Interviews](https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews) — how to scope a problem in the first minutes of an interview.

## Related

- [[Estimation (Deep Dive)]] — turns scale requirements into QPS, storage and server counts.
- [[Trade-offs (Deep Dive)]] — requirements decide which side of each trade-off wins.
- [[Metrics (Deep Dive)]] — where SLIs are measured and alerted on.
- [[Fault Tolerance (Deep Dive)]] — the mechanisms that meet availability SLOs.
- [[High-Level Design (Deep Dive)]] — the next step once requirements are fixed.
- [[Business Goals & Requirements (Deep Dive)]] — requirements for AI systems, including quality and cost targets.

> [!nav] Keep going
> ← [[Databases (Deep Dive)|Databases]] · [[Design Basics|💡 Design Basics]] · [[Estimation (Deep Dive)|Estimation]] →
> 🌱 Back to the basics: [[Requirements]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📖 [Non-functional requirement](https://en.wikipedia.org/wiki/Non-functional_requirement) — Wikipedia. Encyclopedia. Checked 2026-11.
[^2]: 🎓 [A Framework for Mobile System Design Interviews](https://bytebytego.com/courses/mobile-system-design-interview/a-framework-for-mobile-sd-interviews) — ByteByteGo. Course. Checked 2026-11.
[^3]: 🎓 [A Framework For System Design Interviews](https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
[^4]: 📘 [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — Site Reliability Engineering, Google. Book. Checked 2026-11.
[^5]: 📘 [Implementing SLOs](https://sre.google/workbook/implementing-slos/) — The Site Reliability Workbook, Google. Book. Checked 2026-11.
[^6]: 🔬 [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — DeCandia et al., SOSP 2007, sections 1, 2 and 6. Paper. Checked 2026-11.
[^7]: 🔬 [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) — Dean and Barroso, Communications of the ACM, 2013. Paper. Checked 2026-11.
[^8]: 📘 [Embracing Risk](https://sre.google/sre-book/embracing-risk/) — Site Reliability Engineering, Google. Book. Checked 2026-11.
[^9]: 📝 [SRE fundamentals: SLIs, SLAs and SLOs](https://cloud.google.com/blog/products/devops-sre/sre-fundamentals-slis-slas-and-slos) — Google Cloud Blog. Article. Checked 2026-11.
[^10]: 🎓 [Back-of-the-envelope Estimation](https://bytebytego.com/courses/system-design-interview/back-of-the-envelope-estimation) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
[^11]: 📄 [Amazon S3 Service Level Agreement](https://aws.amazon.com/s3/sla/) — Amazon Web Services. Official docs. Checked 2026-11.
[^12]: 📘 [Software Engineering in SRE](https://sre.google/sre-book/software-engineering-in-sre/) — Site Reliability Engineering, Google. Book. Checked 2026-11.
