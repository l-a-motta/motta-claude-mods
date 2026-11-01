---
aliases: [Design Patterns deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/programming]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Programming]]"
basics: "[[Design Patterns]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Programming]] › [[Design Patterns]] › 🔬 Deep Dive

> [!tldr] For engineers
> A design pattern names a recurring **variation point** and a structure that isolates it: object creation (creational), composition (structural) or responsibility and communication (behavioral). The GoF catalog's real value is its **consequences and trade-offs**, not its class diagrams. Many patterns collapse into a language feature (first-class functions, interfaces, modules), and the ones that hide dependencies, singleton above all, cost more in testability than they save.

> [!basics]- New to this? Start with the basics
> [[Design Patterns]] explains it with no jargon.

## How it really works

### Anatomy of a pattern

The 1994 *Design Patterns* book by Gamma, Helm, Johnson and Vlissides catalogs **23 patterns**; for each it states when it applies, how it fits with other design constraints, and its consequences and trade-offs, with example code in C++ or Smalltalk.[^1] Modern catalogs keep that shape: **intent** (problem and solution in brief), **motivation**, **structure** (participants and relationships) and a **code example**, sometimes adding applicability and relations to other patterns.[^2] A pattern is a blueprint, not a recipe: the same pattern produces different code in different programs.[^2]

The vocabulary came from architecture. Alexander, Ishikawa and Silverstein's *A Pattern Language* (1977) pairs each of its 253 patterns with a problem, a discussion and a solution.[^3]

### The three families

| Family | Concern | Examples |
| --- | --- | --- |
| Creational | How objects are instantiated, so callers don't hard-code concrete classes[^4] | Factory Method, Abstract Factory, Builder, Prototype, Singleton[^5] |
| Structural | Assembling objects and classes into larger structures that stay flexible[^4] | Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy[^5] |
| Behavioral | How objects interact and divide responsibilities[^4] | Observer, Strategy, Command, Iterator, State, Visitor and four more[^5] |

Patterns also come at other scales: **idioms** are language-specific and low-level; **architectural patterns** shape a whole application.[^4]

### Four patterns worth knowing cold

**Factory Method.** Defer the choice of concrete class to a method that subclasses or configuration can change. Callers ask for a `Notifier`, not an `EmailNotifier`, so adding a new channel doesn't touch them.

```python
def make_notifier(channel: str) -> Notifier:
    return {"email": EmailNotifier, "sms": SmsNotifier}[channel]()
```

**Singleton.** Guarantee one instance and give global access to it.[^6] It solves two problems at once, which is itself an SRP violation, and naive lazy initialization races: two threads can each create an instance unless creation is guarded by a lock and a re-check after acquiring it.[^6]

```java
private static volatile Database instance;

public static Database getInstance() {
    if (instance == null) {
        synchronized (Database.class) {
            if (instance == null) instance = new Database();
        }
    }
    return instance;
}
```

Many teams skip the hand-rolled version entirely and pass one shared instance in through constructors (dependency injection, below).

**Observer.** A publisher keeps a subscriber list and calls each subscriber's `update` when an event occurs. The publisher depends only on the subscriber interface, so new subscribers need no publisher changes and relationships can form at runtime.[^7] The cost: no control over notification order.[^7]

**Strategy.** Put each variant of an algorithm behind a common interface and let the context hold one, swappable at runtime: route building for car, walking or transit in a navigation app.[^8] In languages with first-class functions, a lambda often replaces the strategy class and its interface entirely.[^8]

```typescript
type RouteStrategy = (from: Point, to: Point) => Route;
navigator.setStrategy(walkingRoute);   // a function, not a class hierarchy
```

### Dependency injection: the pattern that replaced singletons

Martin Fowler named **Dependency Injection** in January 2004 for what lightweight containers were doing under the vague label "Inversion of Control": an assembler hands a component its dependencies instead of the component creating or looking them up.[^9] He describes three forms, constructor, setter and interface injection, preferring constructor injection by default.[^9] The alternative, a **Service Locator**, has classes ask a registry; it removes dependencies on concrete classes too, but every user then depends on the locator, and dependencies hide in lookup calls rather than showing in constructors.[^9]

### Patterns as missing language features

In a 1996 talk Peter Norvig found that **16 of the 23** GoF patterns are "either invisible or simpler" in Dylan or Lisp, thanks to first-class types (6 patterns), first-class functions (4), macros (2), method combination (2), multimethods (1) and modules (1).[^10] Observer, for example, falls out of method combination; Command and Strategy become plain functions.[^10] Refactoring.Guru's catalog makes the same point about Strategy and lambdas.[^11]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Singleton | One instance guaranteed; lazy init[^6] | Global state; hidden coupling; hard to mock; thread-safety care[^6] |
| Dependency injection | Dependencies visible in constructors and setters[^9] | Wiring code or a container to configure |
| Service locator | Simple, direct lookup[^9] | Every class depends on the locator; dependencies invisible[^9] |
| Observer (in-process) | Loose coupling; runtime subscription[^7] | Unordered notifications; leaks if listeners aren't removed[^7][^12] |
| Strategy as class | Named, documented, can hold state | Extra classes and interfaces |
| Strategy as function | Minimal code[^8] | Less discoverable; harder to attach metadata |
| Factory | Callers decoupled from concrete classes | One more indirection to read through |

Rule of thumb: introduce a pattern when a **second** variant actually appears, not when you imagine one might.

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Patterns in the GoF catalog | 23, published 1994 (Addison-Wesley)[^1] |
| Patterns in Alexander's *A Pattern Language* | 253, published 1977[^3] |
| GoF patterns simpler or invisible in Lisp/Dylan | 16 of 23 (Norvig, May 1996)[^10][^13] |
| Of those 16, made simpler by first-class types / functions | 6 / 4[^10] |
| Forms of dependency injection Fowler describes | 3 (constructor, setter, interface), January 2004[^9] |
| `java.util.Observable` deprecated | Since Java SE 9[^14] |

## Failure modes

- **Golden hammer.** Newcomers apply patterns where simple code works; patterns applied "to the letter" without adapting to context produce inefficient designs.[^11] Defense: require a concrete variation point before adding the abstraction.
- **Singletons as hidden globals.** A singleton is reachable from anywhere, so a class can depend on it without saying so in its API. A 2008 Google Testing Blog post summed up the complaint in its title, "Singletons are Pathological Liars".[^15] Private constructors and static access make mocking hard enough that one catalog jokes the alternative is "just don't write the tests".[^6] Defense: pass the shared instance in through the constructor.
- **Racy lazy initialization.** Two threads both see `instance == null` and create two objects.[^6] Defense: eager initialization, a lock with re-check, or a container-managed scope.
- **Leaking observers.** Listeners that are never unsubscribed keep their objects alive. In the browser, `removeEventListener` only works with the same function reference that was registered, so an inline anonymous listener can never be removed that way; an `AbortSignal` is the escape hatch.[^12]
- **Weak event models.** Java deprecated `Observable` because its event model was "quite limited", notification order was unspecified and notifications didn't map one-to-one to state changes; the docs point to `java.beans`, `java.util.concurrent` and the reactive `Flow` API instead.[^14]
- **Slow subscribers on a single thread.** In-process observers run synchronously; one slow handler stalls everything behind it, the same way a heavy callback blocks Node's event loop.[^16] Defense: hand work to a queue or worker.

## In the real world

- **Every browser** implements Observer through `EventTarget.addEventListener`: many listeners per event type, each added once per function reference.[^12]
- **Java** shipped `Observer`/`Observable` in `java.util` and deprecated both in Java 9 in favor of richer event and reactive APIs.[^14]
- **Spring and PicoContainer** were Fowler's examples of setter and constructor injection respectively.[^9]
- **Lisp and Dylan** absorb Strategy, Command, Template Method and Visitor into first-class functions.[^10]
- At system scale, Observer becomes publish/subscribe over a broker: see [[Message Queues (Deep Dive)]].

## In a design interview

Patterns matter most in **low-level design** rounds. Name a pattern only after naming the problem it solves.

1. **Find the variation points** in the requirements: pricing rules that differ, notification channels that grow, object types created from input.
2. **Match each to a pattern** in one sentence: "Pricing varies by vehicle and time, so `PricingStrategy` behind an interface."
3. **State the trade-off** you accept: "One more interface, but adding surge pricing doesn't touch `Ticket`."
4. **Inject dependencies** through constructors so each class can be tested alone.

What interviewers probe: *Why a pattern here at all?* *Is your singleton thread-safe, and how would you test code that uses it?* *What happens if an observer throws or is slow?* *Could a function replace this class?*

## Check yourself

> [!question]- Why does Fowler's dependency injection make dependencies more visible than a service locator?
> With injection, every dependency appears in the constructor or setters, so reading the signature tells you what the class needs. With a locator, dependencies hide inside lookup calls scattered through the code, and every class also depends on the locator itself.

> [!question]- Your observer-based order system sometimes sends the receipt email before the inventory update commits. What is the root cause and a fix?
> In-process observers have no guaranteed order. Either make the dependency explicit (inventory publishes "reserved", the email subscribes to that event) or move to a queue with ordered, durable delivery.

> [!question]- When is Strategy not worth a class hierarchy?
> When variants are stateless functions and the language has first-class functions. Pass a function instead; keep classes for strategies that carry configuration or state.

## Further reading

- 📝 [Refactoring.Guru design patterns catalog](https://refactoring.guru/design-patterns/what-is-pattern) — the friendliest modern walk-through of all 23 GoF patterns with diagrams and code.
- 📘 [Design Patterns (Gamma et al.)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610) — the original catalog; read the consequences sections.
- 📝 [Inversion of Control Containers and the Dependency Injection pattern](https://martinfowler.com/articles/injection.html) — where the term DI comes from, with a fair comparison to service locators.
- 🎥 [Design Patterns in Dynamic Languages](https://norvig.com/design-patterns/design-patterns.pdf) — Norvig's slides on which patterns a richer language makes disappear.

## Related

- [[Object-Oriented Programming (Deep Dive)]] — dispatch, interfaces and SOLID, the mechanics patterns rely on.
- [[Low-Level Design (Deep Dive)]] — where patterns are tested in interviews.
- [[Message Queues (Deep Dive)]] — observer at system scale.
- [[Concurrency (Deep Dive)]] — thread-safe initialization and why shared singletons race.
- [[Microservices (Deep Dive)]] — architectural patterns one level up.

> [!nav] Keep going
> ← [[Object-Oriented Programming (Deep Dive)|Object-Oriented Programming]] · [[Programming|💻 Programming]] · [[Concurrency (Deep Dive)|Concurrency]] →
> 🌱 Back to the basics: [[Design Patterns]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📘 [Design Patterns: Elements of Reusable Object-Oriented Software](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610) — Gamma, Helm, Johnson, Vlissides; Addison-Wesley. Book. Checked 2026-11.
[^2]: 📝 [What's a design pattern?](https://refactoring.guru/design-patterns/what-is-pattern) — Refactoring.Guru. Article. Checked 2026-11.
[^3]: 📖 [A Pattern Language](https://en.wikipedia.org/wiki/A_Pattern_Language) — Wikipedia. Encyclopedia. Checked 2026-11.
[^4]: 📝 [Classification of patterns](https://refactoring.guru/design-patterns/classification) — Refactoring.Guru. Article. Checked 2026-11.
[^5]: 📝 [The Catalog of Design Patterns](https://refactoring.guru/design-patterns/catalog) — Refactoring.Guru. Article. Checked 2026-11.
[^6]: 📝 [Singleton](https://refactoring.guru/design-patterns/singleton) — Refactoring.Guru. Article. Checked 2026-11.
[^7]: 📝 [Observer](https://refactoring.guru/design-patterns/observer) — Refactoring.Guru. Article. Checked 2026-11.
[^8]: 📝 [Strategy](https://refactoring.guru/design-patterns/strategy) — Refactoring.Guru. Article. Checked 2026-11.
[^9]: 📝 [Inversion of Control Containers and the Dependency Injection pattern](https://martinfowler.com/articles/injection.html) — Martin Fowler. Article. Checked 2026-11.
[^10]: 🎥 [Design Patterns in Dynamic Languages (slides)](https://norvig.com/design-patterns/design-patterns.pdf) — Peter Norvig, Object World, 1996. Talk. Checked 2026-11.
[^11]: 📝 [Criticism of patterns](https://refactoring.guru/design-patterns/criticism) — Refactoring.Guru. Article. Checked 2026-11.
[^12]: 📄 [EventTarget: addEventListener() method](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener) — MDN Web Docs. Official docs. Checked 2026-11.
[^13]: 🎥 [Design Patterns in Dynamic Languages](https://norvig.com/design-patterns/) — Peter Norvig, talk page with presentation date. Talk. Checked 2026-11.
[^14]: 📄 [Class Observable](https://docs.oracle.com/javase/9/docs/api/java/util/Observable.html) — Oracle, Java SE 9 API documentation. Official docs. Checked 2026-11.
[^15]: 📝 [Singletons are Pathological Liars](https://testing.googleblog.com/2008/08/by-miko-hevery-so-you-join-new-project.html) — Miško Hevery, Google Testing Blog, 2008. Article. Checked 2026-11.
[^16]: 📄 [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js. Official docs. Checked 2026-11.
