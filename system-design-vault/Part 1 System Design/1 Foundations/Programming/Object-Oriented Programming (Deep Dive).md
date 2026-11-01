---
aliases: [Object-Oriented Programming deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/programming]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Programming]]"
basics: "[[Object-Oriented Programming]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Programming]] › [[Object-Oriented Programming]] › 🔬 Deep Dive

> [!tldr] For engineers
> OOP couples state with the operations on it and routes calls through **dynamic dispatch**, so callers depend on an interface rather than a concrete type. Encapsulation, subtyping and implementation inheritance are separate tools: the first two are what make code changeable, the third is where most of the pain lives. SOLID is a set of heuristics for keeping dependencies pointed at stable abstractions.

> [!basics]- New to this? Start with the basics
> [[Object-Oriented Programming]] explains it with no jargon.

## How it really works

An object is **state plus behavior**: fields hold the state, methods expose the behavior, and the methods are the main way objects talk to each other.[^1] Everything else in OOP is a mechanism for deciding *which* code runs when a method is called, and *who* is allowed to touch the state.

### Dynamic dispatch

The defining runtime mechanism is **dynamic dispatch**: the method to execute is picked at runtime from the receiver's actual type, not at compile time from the variable's declared type.[^2] Java calls it virtual method invocation. The JVM "calls the appropriate method for the object that is referred to in each variable", not the one defined by the variable's type.[^3]

```java
Bicycle bike = new MountainBike(20, 10, 5, "Dual");
bike.printDescription();   // runs MountainBike.printDescription()
```

In Python "all methods are effectively virtual"; `x.f()` is just sugar for `MyClass.f(x)`, with the instance passed as the first argument.[^4] C++ provides runtime dispatch through `virtual` functions, and Stroustrup notes that generic programming, which resolves calls at compile time, has become dominant in areas where run-time performance is important.[^5] If the choice depends on the runtime types of several arguments, not just the receiver, it is called **multiple dispatch**.[^2]

### Classes vs. prototypes

In class-based languages such as Java, a class is a separate template and an instance of a subclass is a single object combining fields from the whole hierarchy. JavaScript is prototype-based: each level of the hierarchy is a separate object linked through `__proto__`, which MDN describes as closer to **delegation** than inheritance, and delegation can be rewired at runtime.[^6] The `class` keyword in modern JavaScript is syntax layered on that prototype model.[^6]

### Encapsulation: enforced vs. conventional

Java enforces access with `private`, so all interaction goes through methods; the classic example is a `changeGear` method that rejects values outside 1–6.[^1] Python enforces nothing: `_name` means "non-public by convention", and `__name` is textually mangled to `_ClassName__name` to avoid accidental clashes in subclasses, not to protect data.[^4] The tutorial is blunt: "nothing in Python makes it possible to enforce data hiding".[^4]

### Inheritance and method resolution

Java allows **one direct superclass** per class, while any class can have unlimited subclasses.[^7] Languages with multiple inheritance must linearize the class graph to decide lookup order. Python has used the **C3 linearization** since Python 2.3, after the 2.2 order was shown not to be monotonic.[^8] Because every class inherits from `object`, diamonds are everywhere, and when C3 cannot find a consistent order Python raises `TypeError` rather than guessing.[^8]

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass
D.__mro__   # (D, B, C, A, object)
```

### Interfaces without hierarchies

Go has methods and an object-oriented style but **no type hierarchy**: a type satisfies any interface whose methods it has, without declaring it.[^9] The Go team's argument is that classic OOP spends "too much discussion of the relationships between types".[^9] Java gets a similar effect with explicit interfaces: code written against `List` runs unchanged on `ArrayList` or `LinkedList`.[^10]

### SOLID

Robert C. Martin collected five class-design principles in his 2000 paper "Design Principles and Design Patterns"; Michael Feathers coined the acronym around 2004.[^11]

| Principle | Martin's short form |
| --- | --- |
| **S**ingle responsibility | "Gather together the things that change for the same reasons. Separate those things that change for different reasons."[^12] |
| **O**pen–closed | Open for extension, closed for modification.[^13] |
| **L**iskov substitution | Code using an interface must not be confused by any implementation of it; about subtyping, not inheritance.[^13] |
| **I**nterface segregation | Keep interfaces small so clients don't depend on methods they don't use.[^13] |
| **D**ependency inversion | Source dependencies point toward high-level abstractions, not low-level details.[^13] |

Martin's own SRP example: an `Employee` with `calculatePay` (owned by the CFO's org), `reportHours` (COO) and `save` (CTO) has three reasons to change, so a change for one group can break another's feature.[^12] "This principle is about people."[^12]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Implementation inheritance | Reuse with little code; subclass states only what differs[^7] | Tight coupling to the parent; superclass behavior isn't visible in the subclass file[^7] |
| Composition + interfaces | Parts swap at runtime; small, testable units | More wiring and indirection |
| Implicit interfaces (Go) | No hierarchy to maintain; types fit many interfaces[^9] | Intent less visible; accidental satisfaction |
| Enforced privacy (Java, C#) | Invariants guaranteed by the compiler[^1] | Ceremony: getters, setters, access modifiers |
| Conventional privacy (Python) | Less boilerplate; easy introspection | Nothing stops a caller breaking invariants[^4] |
| Single inheritance | Simple, predictable lookup[^7] | Shared behavior must move to interfaces or helpers |
| Multiple inheritance | Mixins; reuse from several parents | Diamonds; needs a linearization such as C3[^8] |
| Class-based | Structure known up front; tooling friendly | Hierarchy is fixed at definition time |
| Prototype-based (JS) | Delegation can change at runtime[^6] | Easier to create surprising object graphs |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Simula 67, first language with classes, inheritance and dynamic binding | 1967[^2] |
| Alan Kay using the term "object-oriented programming" | By 1967[^2] |
| Smalltalk at Xerox PARC | 1970s[^2] |
| C++: work begins / first internal use / first commercial release | 1979 / Aug 1983 / Oct 1985[^5] |
| Gang of Four *Design Patterns*, a catalog of OO designs | 1994, 23 patterns[^14] |
| Martin's SOLID principles / acronym | 2000 paper / ~2004 (Feathers)[^11] |
| C3 method resolution order in Python | Since 2.3[^8] |
| Direct superclasses per Java class | Exactly 1[^7] |

## Failure modes

- **Gorilla-banana coupling.** Inheriting drags in the whole parent context. Erlang's Joe Armstrong put it as wanting a banana and getting "a gorilla holding the banana and the entire jungle".[^2] Defense: shallow hierarchies; inherit only for true is-a relationships and compose the rest.
- **Hierarchies forced onto non-hierarchical problems.** Stroustrup calls OOP "not a panacea" and says the main weakness is people forcing "too many problems into a hierarchical mould".[^5] Defense: use plain functions, generics or data records where there is no real hierarchy.
- **God classes.** One class serves several actors, so unrelated changes collide; Martin's `Employee` example is the canonical case.[^12] Defense: split by reason to change.
- **Broken substitutability.** A subtype that surprises callers of its base type (throws on an operation the base supports, tightens a precondition) breaks every caller that trusted the abstraction.[^13] Java's own collections show the risk: `Arrays.asList` returns a `List` that rejects `add` and `remove`.[^10] Defense: document contracts and test implementations against the base type's contract.
- **Shared mutable class state.** In Python, a mutable class attribute such as `tricks = []` is shared by every instance, so one dog's trick shows up on all dogs.[^4] Defense: create per-instance state in `__init__`.
- **Leaky encapsulation.** Exposing internals through getters and setters for every field turns an object back into a struct with extra steps. Defense: expose behavior ("withdraw") rather than state ("setBalance").

## In the real world

- **Java collections** are the textbook use of interface-based polymorphism: algorithms such as `Collections.shuffle` and a generic `swap` work on any `List` implementation.[^10]
- **Go** deliberately left out type inheritance and uses implicit interfaces and embedding instead.[^9]
- **Python** supports multiple inheritance with C3 and relies on convention for privacy.[^4][^8]
- **JavaScript** runs on prototypes, with `class` syntax layered on top.[^6]
- **C++** is, in its creator's words, "multi-paradigm", supporting OOP alongside generic and other styles.[^5]
- Martin argues SOLID still applies at service scale: a microservice that mixes code changing for different reasons is just as tangled.[^13]

## In a design interview

OOP shows up in **low-level design** rounds: "design a parking lot", "design an elevator", "design a library system". Interviewers look for clean responsibilities and extension points, not UML.

1. **Clarify** the use cases and actors.
2. **Find the nouns** (candidate classes) and **verbs** (methods). Drop nouns that are just fields.
3. **Assign responsibilities** so each class has one reason to change.
4. **Put interfaces at the variation points:** `PricingStrategy`, `PaymentMethod`, `VehicleType`.
5. **Prefer composition**; inherit only for genuine is-a relationships.
6. **Walk a scenario** end to end, then show how a new requirement adds a class instead of editing old ones (open–closed).

Common probes: *Why inheritance here and not composition?* *What if a new vehicle type arrives?* *How would you test this class in isolation?* (Inject its dependencies.) *Is this thread-safe?* (See [[Concurrency (Deep Dive)]].)

## Check yourself

> [!question]- Why is the Liskov substitution principle about subtyping rather than inheritance?
> It concerns whether callers of an interface or base type can use any implementation without surprises. A class can inherit code and still violate that contract, and a type can satisfy it without inheriting anything, as Go's implicit interfaces show.

> [!question]- In Python, `class D(B, C)` where both B and C inherit from A. In what order are methods looked up, and why not depth-first?
> `D, B, C, A, object`, from the C3 linearization. Plain depth-first would visit A before C, so A's methods could override C's even though C is more specific. C3 keeps local precedence order and monotonicity.

> [!question]- An `Order` class computes tax, renders an invoice PDF and saves itself to the database. What is wrong and how do you fix it?
> It has three reasons to change, owned by different groups (finance, document design, data). Split it into a tax calculator, an invoice renderer and an order repository, each behind an interface the `Order` workflow depends on.

## Further reading

- 📄 [The Java Tutorials: Object-Oriented Programming Concepts](https://docs.oracle.com/javase/tutorial/java/concepts/object.html) — the clearest short introduction to objects, encapsulation and inheritance.
- 📄 [Object-oriented programming (MDN)](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Advanced_JavaScript_objects/Object-oriented_programming) — classical OOP compared head-on with JavaScript's prototypes.
- 📝 [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html) — Martin's own explanation of "reason to change" as people.
- 📄 [The Python 2.3 Method Resolution Order](https://docs.python.org/3/howto/mro.html) — how C3 linearization resolves diamonds, with worked examples.
- 📄 [Go FAQ](https://go.dev/doc/faq) — why a modern language chose interfaces without inheritance.

## Related

- [[Design Patterns (Deep Dive)]] — reusable object arrangements built on these mechanisms.
- [[Low-Level Design (Deep Dive)]] — where OOP design is tested in interviews.
- [[Concurrency (Deep Dive)]] — shared mutable objects are where races live.
- [[Data Structures (Deep Dive)]] — the collections that interfaces like `List` abstract.
- [[Microservices (Deep Dive)]] — encapsulation and single responsibility at service scale.

> [!nav] Keep going
> [[Programming|💻 Programming]] · [[Design Patterns (Deep Dive)|Design Patterns]] →
> 🌱 Back to the basics: [[Object-Oriented Programming]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [What Is an Object?](https://docs.oracle.com/javase/tutorial/java/concepts/object.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^2]: 📖 [Object-oriented programming](https://en.wikipedia.org/wiki/Object-oriented_programming) — Wikipedia. Encyclopedia. Checked 2026-11.
[^3]: 📄 [Polymorphism](https://docs.oracle.com/javase/tutorial/java/IandI/polymorphism.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^4]: 📄 [Classes](https://docs.python.org/3/tutorial/classes.html) — The Python Tutorial, Python Software Foundation. Official docs. Checked 2026-11.
[^5]: 📝 [Bjarne Stroustrup's FAQ](https://www.stroustrup.com/bs_faq.html) — Bjarne Stroustrup. Article. Checked 2026-11.
[^6]: 📄 [Object-oriented programming](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Advanced_JavaScript_objects/Object-oriented_programming) — MDN Web Docs. Official docs. Checked 2026-11.
[^7]: 📄 [What Is Inheritance?](https://docs.oracle.com/javase/tutorial/java/concepts/inheritance.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^8]: 📄 [The Python 2.3 Method Resolution Order](https://docs.python.org/3/howto/mro.html) — Python documentation. Official docs. Checked 2026-11.
[^9]: 📄 [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — The Go Programming Language. Official docs. Checked 2026-11.
[^10]: 📄 [The List Interface](https://docs.oracle.com/javase/tutorial/collections/interfaces/list.html) — Oracle, The Java Tutorials. Official docs. Checked 2026-11.
[^11]: 📖 [SOLID](https://en.wikipedia.org/wiki/SOLID) — Wikipedia. Encyclopedia. Checked 2026-11.
[^12]: 📝 [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html) — Robert C. Martin, The Clean Code Blog. Article. Checked 2026-11.
[^13]: 📝 [Solid Relevance](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html) — Robert C. Martin, The Clean Code Blog. Article. Checked 2026-11.
[^14]: 📘 [Design Patterns: Elements of Reusable Object-Oriented Software](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610) — Gamma, Helm, Johnson, Vlissides; Addison-Wesley. Book. Checked 2026-11.
