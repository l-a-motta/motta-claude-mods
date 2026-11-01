---
aliases: [Low-Level Design deep dive]
tags: [level/deep-dive, part/1, section/production, branch/projects]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Projects]]"
basics: "[[Low-Level Design]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Projects]] › [[Low-Level Design]] › 🔬 Deep Dive

> [!tldr] For engineers
> Low-level design turns one component of the high-level design into **types, responsibilities, relationships, interfaces and state machines** precise enough to code against. The working toolkit is small: SOLID for where to draw boundaries, a handful of GoF patterns, UML class, sequence and state diagrams as sketches, and explicit transition rules for anything with a lifecycle. Good LLD optimizes for **change**: a new requirement should add a class, not edit ten conditionals.

> [!basics]- New to this? Start with the basics
> [[Low-Level Design]] explains it with no jargon.

## How it really works

LLD starts where [[High-Level Design (Deep Dive)|high-level design]] stops: at one container or component. It is created from the HLD and refines it, covering data structures, algorithms and the logical design of each module.[^1][^2] In C4 terms it is the **code level**, drawn with "UML class diagrams, entity relationship diagrams or similar".[^2]

The output answers five questions per component:

1. **Which types exist?** Usually the nouns of the use cases (Ticket, Spot, Payment).
2. **What is each one responsible for?** One reason to change each.
3. **How do they relate?** Ownership, use, inheritance, multiplicity.
4. **What are the contracts?** Interfaces and method signatures other code depends on.
5. **What lifecycle does each stateful object have?** States, legal transitions, who triggers them.

### Boundaries: SOLID

Robert C. Martin's five principles are the usual yardstick, and he argues they remain as relevant as in the 1990s:[^3]

| Principle | Martin's one-liner | LLD smell it prevents |
| --- | --- | --- |
| **S**ingle responsibility | "Gather together the things that change for the same reasons." | A class mixing business rules with SQL or UI |
| **O**pen–closed | Open for extension, closed for modification | `if`/`switch` on type scattered everywhere |
| **L**iskov substitution | Users of an interface must not be confused by an implementation | Subclasses that throw on inherited methods |
| **I**nterface segregation | "Keep interfaces small" | Clients recompiled for methods they never call |
| **D**ependency inversion | "Depend in the direction of abstraction." | Domain logic importing a database driver |

### Notation: UML, used as a sketch

UML 2 defines 14 diagram types, seven structural and seven behavioral.[^4][^5] LLD mostly needs three: **class** (structure), **sequence** (who calls whom, in order) and **state machine** (lifecycle). The current version, UML 2.5.1, was published by the OMG in December 2017.[^6]

Class-diagram relationships carry real design meaning:[^7][^8]

| Relationship | Notation | Meaning |
| --- | --- | --- |
| Association | Solid line | A structural link; arrowheads show navigability |
| Aggregation | Hollow diamond | "Has a"; parts can outlive the whole |
| Composition | Filled diamond | Whole owns the parts' lifecycle; they die with it |
| Generalization | Hollow triangle | "Is a" (inheritance) |
| Dependency | Dashed arrow | Uses; a change may ripple |

Multiplicities (`1`, `0..1`, `*`, `1..*`) are where hidden requirements surface: can a ticket exist without a spot?[^8]

### Patterns

The 1994 "Gang of Four" book, *Design Patterns: Elements of Reusable Object-Oriented Software*, catalogued 23 patterns.[^9] A pattern is "not a specific piece of code, but a general concept for solving a particular problem".[^10] In LLD rounds the recurring ones are Strategy (swap an algorithm, e.g. pricing), State (behavior varies by lifecycle state), Observer (notify on events), Factory (hide construction) and Decorator (layer behavior).

### State machines

Anything with a lifecycle needs an explicit transition table. Stripe's PaymentIntent is a good public model: `requires_payment_method` → `requires_confirmation` → `requires_action` → `processing` → `succeeded`, with `requires_capture` for separate authorize-and-capture and `canceled` as a terminal state.[^11] A failed attempt returns to `requires_payment_method`; cancellation is allowed only before `processing` or `succeeded` (with exceptions for some bank debits) and cannot be undone.[^11]

```python
from enum import Enum

class Status(Enum):
    REQUIRES_PAYMENT_METHOD = 1; REQUIRES_ACTION = 2; PROCESSING = 3
    SUCCEEDED = 4; CANCELED = 5

ALLOWED = {
    Status.REQUIRES_PAYMENT_METHOD: {Status.REQUIRES_ACTION, Status.PROCESSING, Status.CANCELED},
    Status.REQUIRES_ACTION: {Status.PROCESSING, Status.REQUIRES_PAYMENT_METHOD, Status.CANCELED},
    Status.PROCESSING: {Status.SUCCEEDED, Status.REQUIRES_PAYMENT_METHOD},
    Status.SUCCEEDED: set(), Status.CANCELED: set(),
}

class Payment:
    def __init__(self):
        self.status = Status.REQUIRES_PAYMENT_METHOD

    def transition(self, new):
        if new not in ALLOWED[self.status]:
            raise ValueError(f"{self.status.name} -> {new.name} not allowed")
        self.status = new
```

A table like this is the simple form. When each state carries a lot of behavior, the **State pattern** moves that behavior into one class per state, and the context object delegates to its current state.[^12]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Composition over inheritance | Swap parts at runtime; no fragile base classes | More small objects and wiring |
| Deep inheritance | Shared code with little wiring | LSP violations breed `if`/`switch` checks[^3] |
| Enum + transition table | Compact; whole lifecycle in one place | Behavior per state ends up in conditionals |
| State pattern | Each state's logic isolated; new states without edits (OCP)[^12] | Overkill for few states or rarely changing machines[^12] |
| Small, role-based interfaces | Clients depend only on what they use[^3] | More types to name and navigate |
| UML as sketch | Fast; shows only what matters[^13] | Not a complete spec; can't generate code |
| Hand-maintained code diagrams | Curated, readable | Go stale; C4 suggests generating them with tooling[^2] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| GoF patterns catalogued (1994) | 23[^9] |
| UML 2 diagram types | 14: 7 structure, 7 behavior[^4][^5] |
| Current UML version | 2.5.1, December 2017[^6] |
| SOLID principles | 5; as relevant now as in the 1990s, per Martin[^3] |
| Stripe PaymentIntent statuses | 7; two renamed in API version 2019-02-11 (e.g. `requires_source` → `requires_payment_method`)[^11] |
| LLD practice problems in one popular catalog | 30+ across easy, medium and hard[^14] |

## Failure modes

- **Conditional sprawl.** Behavior chosen by `switch` on a type or status field spreads to every method, and a new state means editing all of them.[^12] Defend with polymorphism (State or Strategy) once the switch repeats.
- **Illegal transitions.** Any code path that sets `status = ...` directly can skip a step (shipping an unpaid order). Funnel every change through one `transition()` method guarded by a table, as above.
- **Leaky substitution.** A subclass that can't honor its parent's contract forces callers to type-check, which is exactly what Liskov substitution forbids.[^3]
- **Fat interfaces.** One interface serving many clients means a change for one forces others to rebuild and redeploy.[^3] Split by client role.
- **Infrastructure in the domain.** Business rules importing SQL or HTTP code can't be tested or moved; point dependencies at abstractions instead.[^3]
- **Pattern-itis.** Applying patterns where a simple conditional would do adds indirection with no payoff; the State pattern itself warns it is overkill for small machines.[^12]
- **Diagram rot.** Complete hand-drawn class diagrams drift from the code. Keep sketches selective ("comprehensiveness is the enemy of comprehensibility") and generate exhaustive views.[^13][^2]
- **Concurrency blind spots.** Two requests reserving the same parking spot is an LLD bug, not an infrastructure one. Catalogs pair LLD with concurrency problems such as thread-safe blocking queues for this reason.[^14]

## In the real world

- **Stripe** publishes its PaymentIntent lifecycle so integrators code against an explicit state machine; a PaymentIntent may even be canceled automatically if confirmed too many times.[^11]
- **UML in practice** is mostly sketching: Fowler notes that most UML diagrams in books, including his own, are sketches.[^13]
- **Refactoring.Guru** and similar catalogs keep the GoF patterns alive with modern examples, grouped as creational, structural and behavioral.[^10]
- **Interview prep** has converged on a shared problem set: parking lot, elevator, LRU cache, Splitwise, ride sharing.[^14]

## In a design interview

LLD rounds reward a steady, visible process:

1. **Clarify scope.** "Multiple floors? Vehicle sizes? Hourly or flat pricing? Concurrent entries?"
2. **List entities and their responsibilities.** Nouns become classes; verbs become methods.
3. **Draw the class diagram.** Relationships and multiplicities, interfaces for anything that varies (`PricingStrategy`, `SpotAllocator`).
4. **Model lifecycles.** State tables for Ticket and Payment.
5. **Write the core methods.** `park(vehicle) -> Ticket`, `unpark(ticket) -> Receipt`.
6. **Stress it.** Concurrency (two cars, one spot), extension (add EV chargers without editing existing classes), errors.

Interviewers probe: *Why an interface here?* *What changes if pricing becomes dynamic?* *How do you stop double allocation?* Name the principle behind each answer (OCP, DIP), but don't stack patterns to show off.

## Check yourself

> [!question]- When would you replace an enum-plus-table state machine with the State pattern?
> When each state carries substantial, frequently changing behavior, so methods fill up with per-state conditionals. For a few states with little behavior, the table is clearer and the pattern is overkill.

> [!question]- What's the practical difference between aggregation and composition?
> Lifecycle ownership. With composition the whole creates and destroys its parts (an Order and its OrderLines); with aggregation the parts can outlive the whole (a Team and its Players).

> [!question]- A `Bird` base class has `fly()`, and `Penguin` throws on it. Which principle breaks, and what's the fix?
> Liskov substitution: callers of `Bird` are confused by an implementation. Split the abstraction, e.g. a `FlyingBird` interface, so only types that can fly promise to.

## Further reading

- 📝 [Solid Relevance](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html) — Martin's own short restatement of SOLID and why it still applies.
- 📝 [State](https://refactoring.guru/design-patterns/state) — a clear walk-through of the pattern every lifecycle-heavy LLD needs.
- 📄 [How Payment Intents and Setup Intents work](https://docs.stripe.com/payments/paymentintents/lifecycle) — a real, production state machine to study.
- 📝 [UmlAsSketch](https://martinfowler.com/bliki/UmlAsSketch.html) — how to use UML without drowning in it.
- 📝 [Awesome Low-Level Design](https://github.com/ashishps1/awesome-low-level-design) — the standard LLD practice problem list.

## Related

- [[High-Level Design (Deep Dive)]] — the container view an LLD refines.
- [[Object-Oriented Programming (Deep Dive)]] — encapsulation, polymorphism and inheritance in depth.
- [[Design Patterns (Deep Dive)]] — the full pattern catalog.
- [[Concurrency (Deep Dive)]] — locks and races inside one component.
- [[API Design (Deep Dive)]] — the contracts a component exposes.
- [[AI Agents & Tool Use (Deep Dive)]] — tool interfaces and agent state machines.

> [!nav] Keep going
> ← [[High-Level Design (Deep Dive)|High-Level Design]] · [[Projects|📁 Projects]] · [[Case Studies (Deep Dive)|Case Studies]] →
> 🌱 Back to the basics: [[Low-Level Design]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📖 [Low-level design](https://en.wikipedia.org/wiki/Low-level_design) — Wikipedia. Encyclopedia. Checked 2026-11.
[^2]: 📄 [Code diagram](https://c4model.com/diagrams/code) — Simon Brown, The C4 model. Official docs. Checked 2026-11.
[^3]: 📝 [Solid Relevance](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html) — Robert C. Martin, Clean Coder Blog. Article. Checked 2026-11.
[^4]: 📖 [Unified Modeling Language](https://en.wikipedia.org/wiki/Unified_Modeling_Language) — Wikipedia. Encyclopedia. Checked 2026-11.
[^5]: 📝 [Overview of the 14 UML Diagram Types](https://www.visual-paradigm.com/guide/uml-unified-modeling-language/overview-of-the-14-uml-diagram-types/) — Visual Paradigm. Article. Checked 2026-11.
[^6]: 📄 [About the Unified Modeling Language Specification Version 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML) — Object Management Group. Standard. Checked 2026-11.
[^7]: 📖 [Class diagram](https://en.wikipedia.org/wiki/Class_diagram) — Wikipedia. Encyclopedia. Checked 2026-11.
[^8]: 📝 [What is Class Diagram?](https://www.visual-paradigm.com/guide/uml-unified-modeling-language/what-is-class-diagram/) — Visual Paradigm. Article. Checked 2026-11.
[^9]: 📝 [History of patterns](https://refactoring.guru/design-patterns/history) — Refactoring.Guru. Article. Checked 2026-11.
[^10]: 📝 [What's a design pattern?](https://refactoring.guru/design-patterns/what-is-pattern) — Refactoring.Guru. Article. Checked 2026-11.
[^11]: 📄 [How Payment Intents and Setup Intents work](https://docs.stripe.com/payments/paymentintents/lifecycle) — Stripe documentation. Official docs. Checked 2026-11.
[^12]: 📝 [State](https://refactoring.guru/design-patterns/state) — Refactoring.Guru. Article. Checked 2026-11.
[^13]: 📝 [UmlAsSketch](https://martinfowler.com/bliki/UmlAsSketch.html) — Martin Fowler. Article. Checked 2026-11.
[^14]: 📝 [Awesome Low-Level Design](https://github.com/ashishps1/awesome-low-level-design) — ashishps1, GitHub. Article. Checked 2026-11.
