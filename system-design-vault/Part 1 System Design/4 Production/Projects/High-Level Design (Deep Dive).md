---
aliases: [High-Level Design deep dive]
tags: [level/deep-dive, part/1, section/production, branch/projects]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Projects]]"
basics: "[[High-Level Design]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Projects]] › [[High-Level Design]] › 🔬 Deep Dive

> [!tldr] For engineers
> A high-level design fixes the **components, their responsibilities, the data flow between them, and the decisions that are expensive to reverse**: data stores, sync vs. async boundaries, consistency, and where state lives. The artifact is a diagram plus a design doc whose real value is the **trade-offs and alternatives considered**, not the boxes. Keep it at the context/container zoom level, drive it from quantified requirements, and record decisions so they survive the people who made them.

> [!basics]- New to this? Start with the basics
> [[High-Level Design]] explains it with no jargon.

## How it really works

An HLD answers one question: **which parts exist, and how do requests and data move between them?** Everything below the component boundary (classes, schemas in full, algorithms) is [[Low-Level Design (Deep Dive)|low-level design]].

### What goes in it

The design-doc structure used at Google is a good default:[^1]

- **Context and scope** — a brief, objective view of the landscape. Not a requirements doc.
- **Goals and non-goals** — non-goals are things that could reasonably be goals but are explicitly excluded, such as "ACID compliance" for a database.[^1]
- **The actual design** — an overview, then a **system-context diagram**, a sketch of the relevant **APIs** (not copy-pasted definitions), and how and in what rough form **data is stored** (not full schemas).[^1]
- **Alternatives considered** — other designs and why they lost; called one of the most important sections.[^1]
- **Cross-cutting concerns** — security, privacy, observability. Google requires a dedicated privacy design doc and dedicated privacy and security reviews.[^1]

Code and pseudocode are rare in an HLD, reserved for novel algorithms; link a prototype instead.[^1]

### Zoom levels

The C4 model, deliberately notation and tooling independent,[^2] gives a shared vocabulary for "how high is high-level". A **software system** is made of **containers** ("applications and data stores"), each container holds **components**, and components are implemented by **code** elements.[^3] Each level gets its own diagram: system context, container, component, code.[^4] Most HLDs live at the first two levels: the context and container diagrams "are sufficient for most software development teams."[^4]

A practical rule: every box names a **deployable or stateful thing** (service, database, queue, bucket), and every arrow carries a **label** (protocol, sync/async, what flows). Unlabeled arrows are where ambiguity hides.

### The design loop

Whether in a doc or an interview, the work follows the same order:[^5][^6]

1. **Requirements.** A prioritized list of functional requirements ("users should be able to…") and a few quantified non-functional ones: latency, availability, scale.[^5]
2. **Core entities and API.** The main nouns (User, Tweet, Follow) and the contract with clients.[^5]
3. **High-level design.** Satisfy each API endpoint in turn with the simplest set of components; narrate how each request flows and what state changes.[^5]
4. **Estimate and stress.** Back-of-the-envelope numbers decide whether a single database survives or you need replicas, sharding, a cache or a queue.[^6][^7]
5. **Deep dives.** Harden the design against the non-functional requirements and bottlenecks.[^5]

### Recording decisions

Diagrams show the *what*; decisions need the *why*. An **Architecture Decision Record (ADR)** captures one architecturally significant decision in a short, numbered file kept in the repository.[^8]

```markdown
# ADR 7: Use a message queue between upload API and thumbnailer

Status: Accepted
Context: Thumbnail generation takes 2-5 s; upload p99 must stay under 300 ms.
Decision: We will publish an event per upload and process it asynchronously.
Consequences: Thumbnails appear with a delay; we must handle duplicate events.
```

Nygard's format is title, context, decision ("We will…"), status (proposed, accepted, deprecated, superseded) and consequences, one or two pages at most.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Full design doc (10–20 pages) | Consensus, senior review, durable record | Days of writing and review; can block progress[^1] |
| Mini design doc (1–3 pages) | Fast; fits incremental work | Thin on alternatives and cross-cutting concerns[^1] |
| ADRs in the repo | Decisions versioned next to code; cheap | No big picture on their own; pair with a diagram[^8][^9] |
| Whiteboard sketch only | Fastest; good for exploration | Lost after the meeting; no review trail |
| Context + container diagrams | Readable by non-specialists; stable over time | Hide component-level coupling[^4] |
| Adding component/code diagrams | Precision inside a container | Goes stale fast; code level is best generated by tools[^4] |
| Simple-first design | Meets core requirements quickly; easy to reason about | Must be revisited when scale arrives[^5] |
| Designing for peak scale up front | Fewer re-architectures | Over-engineering; complexity you may never need[^6] |

The deeper trade-off is **cost of writing vs. cost of being wrong**. Design docs "save money" by avoiding coding dead ends but "cost money" to create and review.[^1] Skip the doc when the design is not ambiguous; if a doc reads like an implementation manual with no trade-offs, writing the code directly would have been better.[^1]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Google design doc, larger project | ~10–20 pages[^1] |
| Google "mini design doc" for incremental work | 1–3 pages[^1] |
| Ubl's checklist: write a doc if this many of five readiness questions are "yes" | 3 or more[^1] |
| ADR length | 1–2 pages at most[^8] |
| C4 levels / levels most teams need | 4 / 2 (context and container)[^4] |
| Interview time on HLD (Xu's framework) | 10–15 min; scope 3–10, deep dive 10–25, wrap-up 3–5[^6] |
| Interview time on HLD (Hello Interview) | ~10–15 min after ~5 min requirements, ~2 min entities, ~5 min API[^5] |
| Round trip within one data center | ~500 µs[^7] |
| Packet California → Netherlands → California | ~150 ms[^7] |

The last two set the shape of many HLDs: a strictly sequential chain of calls manages about 2,000 round trips per second inside a data center but only six or seven worldwide, which is why cross-region traffic gets cached, batched or made asynchronous.[^7]

## Failure modes

- **Diagram drift.** Big specification documents go out of date and few people read them; new engineers then either blindly keep a decision or blindly reverse it.[^8] Defend with small ADRs next to the code and a rule to update the doc until the system ships.[^1][^8]
- **The implementation manual.** A doc with no alternatives or trade-offs adds cost without value.[^1] Require an "alternatives considered" section.
- **Complexity too early.** Layering caches, queues and shards before the core flow works is a common interview failure;[^5] over-engineering is called "a real disease of many engineers".[^6] Start simple, note where complexity *will* go, and add it in the deep dive.
- **Unquantified requirements.** "Must scale" cannot be designed against. Turn it into numbers (QPS, read/write ratio, data growth) before picking components.[^7]
- **Review as a bottleneck.** Formal review meetings add overhead; engineers often get key feedback directly instead of blocking on a meeting.[^1]
- **Missing cross-cutting concerns.** Security, privacy and observability bolted on after the design is set are expensive. Give them their own section.[^1]

## In the real world

- **Google** uses informal design docs, written before coding and reviewed by colleagues; they often become the first entry point for engineers new to a system.[^1]
- **Uber** ran an RFC process (until around 2019) whose service template asked for approvers, architecture changes, SLAs, dependencies, load testing, security, rollout and metrics.[^9]
- **Many others**, among them HashiCorp, Monzo, Sourcegraph and CockroachDB, run RFC or design-doc processes; Monzo's template has a mandatory risks section.[^9]
- **ADRs** are used at Glovo (in code repositories, alongside RFCs) and Klarna (for smaller changes).[^9]
- **C4** gives teams a shared vocabulary for diagrams at different zoom levels.[^2]

## In a design interview

Lead the conversation; it is "open-ended" and you are expected to drive it.[^7] A skeleton:

1. **Clarify (≈5 min):** "Who uses it, how many, what's the read/write ratio, what latency?" Write assumptions down.[^6]
2. **Entities and API (≈5 min):** list the nouns, then the endpoints.[^5]
3. **HLD (≈10–15 min):** one box at a time, one endpoint at a time, saying out loud how a request flows.[^5]
4. **Deep dive (≈10–25 min):** pick the riskiest component with the interviewer.[^6]
5. **Wrap up:** bottlenecks, failure cases, monitoring, the next 10× of scale.[^6]

What gets probed: *Why this database?* *What happens when this box dies?* *Where's the bottleneck at 10× traffic?* Interviewers grade the process more than the final picture: "The final design is less important" than the work that led to it.[^6]

## Check yourself

> [!question]- What makes something a non-goal rather than a negated goal?
> A non-goal is something that could reasonably be a goal but is deliberately excluded, such as ACID compliance for a database. "The system shouldn't crash" is just a negated goal and adds no information.

> [!question]- A reviewer says your HLD diagram has fifteen boxes and three of them are classes. What's wrong?
> The diagram mixes zoom levels. An HLD should stay at the context and container level (deployable or stateful things); classes belong in a component or code view, i.e., the low-level design.

> [!question]- Your team keeps reversing an old decision to use a queue, then re-adding it. What practice would stop this?
> An Architecture Decision Record: a short file in the repo stating the context, the decision, its status and its consequences, so future engineers see why it was made before changing it.

## Further reading

- 📝 [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/) — the clearest description of what a design doc contains and when not to write one.
- 📄 [The C4 model](https://c4model.com/) — a lightweight, notation-independent way to draw architecture at sensible zoom levels.
- 📝 [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the original ADR proposal, still the template most teams copy.
- 📝 [Companies Using RFCs or Design Docs](https://blog.pragmaticengineer.com/rfcs-and-design-docs/) — real templates from Uber, Monzo, Stedi and more.
- 🎓 [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) — a tight, timed recipe for HLD in interviews.

## Related

- [[Requirements (Deep Dive)]] — the quantified inputs that drive the design.
- [[Estimation (Deep Dive)]] — back-of-the-envelope math for sizing each box.
- [[Trade-offs (Deep Dive)]] — the reasoning every design doc must show.
- [[Low-Level Design (Deep Dive)]] — what happens inside one container.
- [[Case Studies (Deep Dive)]] — full HLDs for URL shorteners, feeds and chat.
- [[AI Architecture Layers (Deep Dive)]] — HLD applied to AI systems.

> [!nav] Keep going
> ← [[Distributed Tracing (Deep Dive)|Distributed Tracing]] · [[Projects|📁 Projects]] · [[Low-Level Design (Deep Dive)|Low-Level Design]] →
> 🌱 Back to the basics: [[High-Level Design]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/) — Malte Ubl, Industrial Empathy. Article. Checked 2026-11.
[^2]: 📄 [The C4 model](https://c4model.com/) — Simon Brown. Official docs. Checked 2026-11.
[^3]: 📄 [Abstractions](https://c4model.com/abstractions) — Simon Brown, The C4 model. Official docs. Checked 2026-11.
[^4]: 📄 [Diagrams](https://c4model.com/diagrams) — Simon Brown, The C4 model. Official docs. Checked 2026-11.
[^5]: 🎓 [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) — Hello Interview. Course. Checked 2026-11.
[^6]: 🎓 [A Framework for System Design Interviews](https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
[^7]: 📝 [The System Design Primer](https://github.com/donnemartin/system-design-primer) — Donne Martin, GitHub. Article. Checked 2026-11.
[^8]: 📝 [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — Michael Nygard, Cognitect. Article. Checked 2026-11.
[^9]: 📝 [Companies Using RFCs or Design Docs and Examples of These](https://blog.pragmaticengineer.com/rfcs-and-design-docs/) — Gergely Orosz, The Pragmatic Engineer. Article. Checked 2026-11.
