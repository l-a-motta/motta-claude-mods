---
aliases: [Distributed Tracing deep dive]
tags: [level/deep-dive, part/1, section/production, branch/observability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Observability]]"
basics: "[[Distributed Tracing]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Observability]] › [[Distributed Tracing]] › 🔬 Deep Dive

> [!tldr] For engineers
> A trace is a **tree of timed spans sharing one trace ID**, stitched together because every hop **propagates context** (today, the W3C `traceparent` header). The engineering is in three places: instrumentation that is transparent to application code, **sampling** that keeps overhead and storage bounded without losing the interesting traces, and an **out-of-band** collection pipeline. Google's Dapper set the template; OpenTelemetry and Jaeger carry it forward in open source.

> [!basics]- New to this? Start with the basics
> [[Distributed Tracing]] explains it with no jargon.

## How it really works

### The data model

Dapper modeled a trace as a **tree of spans**. Each span has a human-readable name, a span ID and a parent ID; a span with no parent is the **root span**, and all spans in a trace share a trace ID.[^1] In Dapper these were probabilistically unique 64-bit integers, and a typical trace had one span per RPC, each tier of infrastructure adding a level of depth.[^1]

OpenTelemetry keeps the same shape and adds detail.[^2] An immutable **span context** carries trace ID, span ID, trace flags and trace state. Spans carry **attributes** (key-value metadata), **events** (timestamped, structured log messages on the span), **links** (causal ties to spans in other traces, useful for batch and async work), a **status** (`Unset`, `Error`, `Ok`) and a **kind** (`Client`, `Server`, `Internal`, `Producer`, `Consumer`).[^2]

A span can hold data from two hosts: an RPC span has client and server annotations, so their clocks disagree. Dapper bounds server timestamps using the fact that a client always sends before the server receives, and the server responds before the client gets the reply.[^1]

### Instrumentation

Dapper's key choice was to instrument **only a few shared libraries**: threading, control flow and the RPC framework.[^1] The trace context lives in thread-local storage, callbacks capture their creator's context, and the RPC library carries span and trace IDs from client to server.[^1] That made tracing nearly invisible to application developers, in fewer than 1,000 lines of C++ and 800 of Java for the core.[^1]

OpenTelemetry plays the same role today as a vendor-neutral framework with APIs, language SDKs, semantic conventions and a **Collector** that receives, processes and exports telemetry; it is not a storage backend.[^3] It came from the merger of OpenTracing and OpenCensus.[^3]

### Propagation on the wire

The W3C Trace Context Recommendation standardizes two HTTP headers so traces survive hops between vendors.[^4] `traceparent` has four fields: version, a 16-byte trace ID, an 8-byte parent ID and one byte of flags, whose low bit means "sampled."[^4] `tracestate` carries vendor-specific data, up to 32 list members.[^4]

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendorname1=opaqueValue1,vendorname2=opaqueValue2
```

### Collection: out of band

Dapper writes spans to local log files, daemons pull them, and collectors write each trace as one Bigtable row, one column per span.[^1] It deliberately does **not** piggyback trace data on RPC responses: responses near the root of a trace are often under 10 KB while the trace can span thousands of hosts, so in-band data would dwarf the payload and assumes every call is perfectly nested.[^1]

Jaeger's modern architecture has the same pieces: a **collector** that receives spans and writes to storage, a **query** service and UI, and an optional **ingester** that reads from Kafka when Kafka buffers between collectors and storage.[^5] Storage backends include Cassandra, Elasticsearch, OpenSearch, ClickHouse and Badger, and Jaeger v2 is itself a customized distribution of the OpenTelemetry Collector.[^5]

### Sampling

**Head sampling** decides at the start of a trace, without seeing the whole trace: simple, cheap, and possible anywhere in the pipeline, but it cannot guarantee that traces containing errors are kept.[^6] **Tail sampling** decides after seeing all or most spans, so it can keep every error or slow trace, but it needs stateful components that buffer large amounts of data.[^6] For high-volume systems a 1% rate or lower is usually representative.[^6]

Dapper started with a uniform 1-in-1,024 rate, then moved toward **adaptive** sampling driven by a target rate of traces per unit time, so low-traffic services sample more.[^1] It added a second stage in the collectors: hash the trace ID to a number in [0, 1] and keep the span only if it falls under a coefficient, so whole traces are kept or dropped together.[^1] Uber's Jaeger clients poll the backend for their sampling strategy (probabilistic or rate-limiting), which lets operators adjust rates as traffic peaks and dips during the day.[^7]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Head sampling | Cheap, stateless, consistent across services via the sampled flag | Misses rare errors and outliers |
| Tail sampling | Keeps all errors and slow traces | Stateful buffering, many nodes, complex to run |
| Library-level auto-instrumentation | Broad coverage, no app changes | Coarse spans; blind to custom async or raw sockets |
| Manual spans and attributes | Business context, fine-grained timing | Developer effort; risk of span explosion |
| Out-of-band collection | Does not inflate request payloads or latency | Seconds to minutes of delay before traces are queryable |
| Kafka buffer before storage | Absorbs bursts, decouples collectors from storage | One more system to operate |
| Recording payloads | Richer debugging | Privacy and security risk |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Dapper span creation cost | 204 ns for a root span, 176 ns for a child[^1] |
| Dapper annotation cost | About 9 ns if unsampled, 40 ns if sampled[^1] |
| Latency impact on a web-search cluster | +16.3% sampling every trace, +2.12% at 1/16, within noise at 1/1,024[^1] |
| Dapper daemon CPU | Under 0.3% of one core[^1] |
| Average Dapper span size | 426 bytes; under 0.01% of Google's network traffic[^1] |
| Dapper collection latency | Median under 15 s[^1] |
| Sampled trace data at Google (2010) | Over 1 TB per day[^1] |
| W3C `traceparent` IDs | 16-byte trace ID, 8-byte parent ID[^4] |
| Uber microservices | About 500 in fall 2015, over 2,000 by early 2017[^7] |

## Failure modes

- **Broken propagation.** One service that drops the header splits the trace. Non-standard control flow defeats automatic propagation; at Dapper's writing, 40 C++ and 33 Java applications needed manual propagation.[^1] Test propagation end to end, especially through queues and thread pools.
- **Missing the interesting traces.** Head sampling at 0.1% may never keep the one failing checkout.[^6] Use tail sampling for errors and latency outliers, or always-sample rules for critical routes.
- **Batching misattribution.** When requests are coalesced, for example batched disk writes, one trace can be blamed for the whole batch's work.[^1] Use span links to tie batch work to every contributing trace.[^2]
- **Sensitive data in spans.** Dapper records RPC method names but not payloads, leaving extra data as an opt-in annotation.[^1] Treat span attributes like logs: redact before export.
- **Stale data during firefighting.** Dapper's bulk analysis could not yet finish within 10 minutes of an incident's onset, which limited it in shared-storage emergencies.[^1] Keep metrics as the first alarm and traces for diagnosis.
- **Clock skew.** Spans from different hosts misalign; bound them with client send/receive ordering as Dapper does.[^1]

## In the real world

- **Google Dapper** had been Google's production tracing system for over two years by 2010, supported by nearly every production process.[^1] Ads Review engineers estimate their latency improved by two orders of magnitude using its data, and Google inferred service dependencies automatically from traces.[^1]
- **Uber Jaeger** grew from a Zipkin-compatible prototype: a per-host agent received spans over UDP, Go collectors wrote to Cassandra, and Spark aggregated the data.[^7] It was open-sourced in April 2017, joined the CNCF that September, and graduated in October 2019.[^7]
- **OpenTelemetry** provides vendor-neutral instrumentation and the Collector,[^3] and Jaeger v2 is built on that Collector.[^5]

## In a design interview

Tracing comes up when the design has many services and the interviewer asks how you'd debug latency:

1. **Propagate:** "Every edge, HTTP and gRPC, carries W3C `traceparent`; queue messages carry it as a header."
2. **Instrument:** "OpenTelemetry SDK auto-instrumentation for servers, clients and DB drivers, plus manual spans around key business steps."
3. **Collect and sample:** "Collectors at the edge, head sampling at 1–5%, plus tail rules that keep all errors and anything over the p99 SLO."
4. **Correlate:** "Trace ID stamped on every log line and as an exemplar on latency metrics."

Interviewers probe: *What if a queue sits between services?* (Carry context in message headers; use links or a consumer span.) *How do you keep cost down?* (Sampling.) *How do you avoid losing the error traces?* (Tail sampling.) *Why not just logs?* (Logs lack cross-service causality.)

## Check yourself

> [!question]- Why does Dapper's second-stage sampling hash the trace ID rather than sampling each span independently?
> Spans of one trace live on thousands of hosts. Hashing the shared trace ID gives every collector the same decision, so whole traces are kept or dropped instead of leaving fragments.

> [!question]- Head sampling at 1% is cheap, but your rare payment errors never show up. What changes?
> Add tail sampling (or an error-triggered keep rule) so traces with errors or high latency are always kept, accepting the cost of buffering spans until the trace completes.

> [!question]- Why carry trace data out of band instead of in RPC responses?
> Trace data for a large request can dwarf small responses and skew network behavior, and in-band schemes assume every call is perfectly nested, which async middleware breaks.

## Further reading

- 🔬 [Dapper, a Large-Scale Distributed Systems Tracing Infrastructure](https://static.googleusercontent.com/media/research.google.com/en//archive/papers/dapper-2010-1.pdf) — the founding paper, with real overhead numbers.
- 📄 [Traces](https://opentelemetry.io/docs/concepts/signals/traces/) — the modern span model, explained clearly.
- 📄 [Trace Context](https://www.w3.org/TR/trace-context/) — the standard header format every service should speak.
- 📄 [Sampling](https://opentelemetry.io/docs/concepts/sampling/) — head versus tail sampling and when to use each.
- 📝 [Evolving Distributed Tracing at Uber Engineering](https://www.uber.com/blog/distributed-tracing/) — how Jaeger was born out of microservice sprawl.

## Related

- [[Microservices (Deep Dive)]] — the architecture that makes cross-service causality hard to see.
- [[Logging (Deep Dive)]] — trace IDs on log lines connect the two signals.
- [[Metrics (Deep Dive)]] — metrics alert; traces explain the latency.
- [[gRPC (Deep Dive)]] — RPC metadata is where trace context travels.
- [[Message Queues (Deep Dive)]] — async hops need context in message headers.
- [[AI Agents & Tool Use (Deep Dive)]] — multi-step agent runs are traced like distributed requests.

> [!nav] Keep going
> ← [[Metrics (Deep Dive)|Metrics]] · [[Observability|🔭 Observability]] · [[High-Level Design (Deep Dive)|High-Level Design]] →
> 🌱 Back to the basics: [[Distributed Tracing]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Dapper, a Large-Scale Distributed Systems Tracing Infrastructure](https://static.googleusercontent.com/media/research.google.com/en//archive/papers/dapper-2010-1.pdf) — Sigelman et al., Google Technical Report dapper-2010-1, sections 2–7. Paper. Checked 2026-11.
[^2]: 📄 [Traces](https://opentelemetry.io/docs/concepts/signals/traces/) — OpenTelemetry documentation. Official docs. Checked 2026-11.
[^3]: 📄 [What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/) — OpenTelemetry documentation. Official docs. Checked 2026-11.
[^4]: 📄 [Trace Context](https://www.w3.org/TR/trace-context/) — W3C Recommendation, 2021. Standard. Checked 2026-11.
[^5]: 📄 [Architecture](https://www.jaegertracing.io/docs/latest/architecture/) — Jaeger documentation. Official docs. Checked 2026-11.
[^6]: 📄 [Sampling](https://opentelemetry.io/docs/concepts/sampling/) — OpenTelemetry documentation. Official docs. Checked 2026-11.
[^7]: 📝 [Evolving Distributed Tracing at Uber Engineering](https://www.uber.com/blog/distributed-tracing/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
