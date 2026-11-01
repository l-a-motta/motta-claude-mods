---
aliases: [back-of-the-envelope, capacity planning, QPS, napkin math, latency numbers]
tags: [level/basics, part/1, section/foundations, branch/design-basics]
level: Basics
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Design Basics]]"
deep_dive: "[[Estimation (Deep Dive)]]"
reading_time: 4 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Design Basics]] › Estimation

> [!tldr] In one sentence
> Estimation is **quick, rough math** that tells you how big a system needs to be, and which designs can work, **before you build anything**.

## 🧠 Think of it like…

> [!analogy] Ordering pizza for a party
> Thirty guests, about three slices each, eight slices per pizza. That's roughly 90 slices, so order 12 pizzas. You just need to know it's 12, not 2 and not 200.

System design works the same way. You count **users and requests** instead of guests, and get **servers and storage** instead of pizzas.

## What it is

Engineers call this a **back-of-the-envelope** estimate. Google's Jeff Dean describes the skill as estimating how a design will perform without actually having to build it.[^1]

You combine two things:[^2]

- **Assumptions about use**, such as "150 million people post twice a day."
- **Known performance numbers**, such as how long a memory read takes.

Getting the **order of magnitude** right (thousands versus millions) matters far more than exact digits.[^3]

## Why it matters

- **It sizes the problem.** Ten requests per second fits on one server; a hundred thousand needs a fleet.
- **It kills bad ideas early.** In one of Dean's examples, reading 30 images one by one takes about half a second; reading them all at once takes a few hundredths.[^1]
- **It controls cost.** Ten times too many machines wastes money; ten times too few means an outage.

## How it works

```mermaid
flowchart LR
    A["Daily users"] --> B["Actions per user"]
    B --> C["Requests per day"]
    C --> D["Requests per second"]
    D --> E["Peak traffic"]
    E --> F["Servers, storage, bandwidth"]
```

1. **Start from users** and what each one does per day.
2. **Convert to per second.** A day has 86,400 seconds; round to 100,000. The result is **QPS** (queries per second).[^2]
3. **Plan for the peak.** Traffic is never flat, so multiply by a peak factor.[^2]
4. **Turn load into resources:** servers, storage, bandwidth.

A worked exercise: 150 million daily users who each post twice make 300 million posts a day. Divided by about 86,400 seconds, that's roughly **3,500 posts per second**.[^2] If one in ten posts has a 1 MB photo, that's about 30 terabytes of new photos every day.[^2]

Engineers also memorize a few **latency numbers**: how long common operations take. Fetching from a computer's main memory takes about 100 nanoseconds (billionths of a second). Moving a spinning disk's read head takes about 8 milliseconds, some 80,000 times longer. A message from the US to Europe and back takes about 150 milliseconds.[^4]

## A real-world example

On a normal day in 2013, people sent more than 500 million tweets, about 5,700 per second on average. Then, during a TV broadcast of the film *Castle in the Sky* in Japan, Twitter hit a **one-second peak of 143,199 tweets per second**.[^5] That is about 25 times the average. Twitter had reworked its architecture to remove bottlenecks, and the site held up.[^6]

## Myths and pitfalls

- **❌ Myth:** Estimates must be precise. **✅ Reality:** Round hard. Turning 99,987 ÷ 9.1 into 100,000 ÷ 10 is the expected move.[^2]
- **❌ Myth:** Plan for the average load. **✅ Reality:** Peaks can be many times the average, as Twitter's 25x spike showed.[^5]
- **❌ Myth:** More assumptions make a better estimate. **✅ Reality:** More than about six assumptions usually means you are overcomplicating it.[^3]
- **❌ Myth:** The famous latency numbers never change. **✅ Reality:** Some drift as hardware improves; others, like a trip across an ocean, are fixed by the speed of light.[^7]

## Check yourself

> [!question]- About how many requests per second is one million requests per day?
> Roughly 10: one million divided by about 100,000 seconds (exactly, about 12).

> [!question]- Why multiply the average load by a peak factor?
> Traffic comes in bursts. Size only for the average and the system falls over exactly when most people are using it.

> [!question]- Why does it matter that memory is so much faster than a disk?
> It tells you to keep popular data in memory, which is the whole idea behind caching.

## Key terms

- **Back-of-the-envelope estimate** — quick, rough math to size a system.
- **QPS (queries per second)** — how many requests a system handles each second.
- **Peak load** — the busiest moment, often several times the average.
- **DAU (daily active users)** — people who use the product on a given day.
- **Order of magnitude** — a factor of ten; the level of precision estimates aim for.
- **Latency** — how long one operation or request takes.
- **Capacity planning** — deciding how many machines and how much storage to provision.

> [!deepdive] Ready for the technical take?
> The QPS-to-servers pipeline, Little's Law, classic versus modern latency tables, Dean's worked examples and how Google plans capacity.
> → [[Estimation (Deep Dive)]]

## Related

- [[Requirements]] — supplies the user counts and targets you plug in.
- [[Caching]] — the latency numbers explain why caches pay off.
- [[Load Balancing]] — spreads the QPS you estimated across servers.
- [[Sharding]] — what you do when the storage estimate outgrows one machine.
- [[Cost Optimization]] — predicting cloud and AI bills.
- [[LLM Inference & Optimization]] — the same math applied to tokens and GPUs.

> [!nav] Keep going
> ← [[Requirements]] · [[Design Basics|💡 Design Basics]] · [[Trade-offs]] →
> 🔬 Technical take: [[Estimation (Deep Dive)]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🎥 [Software Engineering Advice from Building Large-Scale Distributed Systems](https://static.googleusercontent.com/media/research.google.com/en//people/jeff/stanford-295-talk.pdf) — Jeff Dean, Google, Stanford CS295 talk slides. Talk. Checked 2026-11.
[^2]: 🎓 [Back-of-the-envelope Estimation](https://bytebytego.com/courses/system-design-interview/back-of-the-envelope-estimation) — Alex Xu, ByteByteGo. Course. Checked 2026-11.
[^3]: 📝 [napkin-math](https://github.com/sirupsen/napkin-math) — open-source project on GitHub. Article. Checked 2026-11.
[^4]: 📝 [Teach Yourself Programming in Ten Years](https://norvig.com/21-days.html) — Peter Norvig, "Answers" table. Article. Checked 2026-11.
[^5]: 📝 [Twitter: New Tweets per Second Record, and How](https://planet.mysql.com/entry/?id=258324) — Raffi Krikorian, Twitter Engineering, republished on Planet MySQL, 2013. Article. Checked 2026-11.
[^6]: 📝 [Twitter sets new tweets per second record](https://www.engadget.com/2013/08/16/twitter-sets-new-tweets-per-second-record/) — Engadget, 2013. Article. Checked 2026-11.
[^7]: 📝 [Latency Numbers Every Programmer Should Know (interactive)](https://colin-scott.github.io/personal_website/research/interactive_latency.html) — Colin Scott. Article. Checked 2026-11.
