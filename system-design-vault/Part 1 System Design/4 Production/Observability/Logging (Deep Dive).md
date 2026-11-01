---
aliases: [Logging deep dive]
tags: [level/deep-dive, part/1, section/production, branch/observability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Observability]]"
basics: "[[Logging]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Observability]] › [[Logging]] › 🔬 Deep Dive

> [!tldr] For engineers
> Logs are **discrete, timestamped events** with the highest detail and the highest cost of the three telemetry signals. A good design emits **structured** events to stdout, ships them through a pipeline that parses, enriches and redacts, and stores them in an engine chosen for the dominant query shape. The hard problems are schema drift, cost at volume, secrets leaking into logs, and correlating a line with the request that produced it.

> [!basics]- New to this? Start with the basics
> [[Logging]] explains it with no jargon.

## How it really works

Every logging system answers four questions: **what goes in an event**, **how it leaves the process**, **where it is stored and indexed**, and **how long it is kept**.

### Anatomy of a log event

OpenTelemetry's log data model is a useful vendor-neutral reference. A `LogRecord` carries a `Timestamp` (when the event happened at the source), an `ObservedTimestamp` (when the collector saw it), `TraceId`/`SpanId`/`TraceFlags` for correlation, `SeverityText` and `SeverityNumber`, a `Body`, a `Resource` (the emitting entity, such as service and host), an `InstrumentationScope`, and free-form `Attributes`.[^1] Its design goal is that existing formats map onto it unambiguously and that converting A → model → B loses nothing a direct A → B conversion would keep.[^1]

Severity is normalized to a number so that levels from different libraries compare cleanly:[^1]

| SeverityNumber | Level |
| --- | --- |
| 1–4 | TRACE |
| 5–8 | DEBUG |
| 9–12 | INFO |
| 13–16 | WARN |
| 17–20 | ERROR |
| 21–24 | FATAL |

### Structured over free text

An unstructured line can only be searched as a string; you cannot index or query individual keys.[^2] A structured entry stores its payload as a JSON object, so fields become filterable and indexable.[^2] Google Cloud's agents, for example, parse single-line JSON from stdout and lift `severity`, `message`, `httpRequest` and trace fields into the top-level entry.[^2]

```json
{"time":"2026-11-01T14:03:22.418Z","severity":"ERROR","service":"checkout",
 "message":"payment declined","order_id":"o-81723","amount_cents":4599,
 "trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7"}
```

The `trace_id` is the bridge to [[Distributed Tracing (Deep Dive)|distributed tracing]]: logs on their own usually lack context about the request they belong to, and become far more useful when attached to a span.[^3]

### Getting logs out of the process

The Twelve-Factor guidance is still the default for containers: the app writes its event stream **unbuffered to stdout** and never manages log files or routing.[^4] The execution environment captures every process's stream, merges them and forwards them to destinations such as Splunk or a Hadoop/Hive warehouse.[^4] This keeps the app simple and lets the platform change destinations without a deploy.

### The pipeline

```mermaid
flowchart LR
    A["Services (stdout)"] --> B["Node agent"]
    B --> C["Processing: parse, enrich, redact"]
    C --> D["Buffer"]
    D --> E["Index and store"]
    E --> F["Query and dashboards"]
```

The processing tier is where Logstash sits in the ELK stack: an open-source collection engine with real-time pipelining that unifies data from disparate sources through input, filter and output plugins.[^5] Elasticsearch, a distributed JSON-based search and analytics engine, stores and indexes the result, and Kibana is the UI for exploring it.[^6] A buffer between shippers and storage absorbs bursts, so an indexing slowdown does not push back on the services.

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Structured JSON | Field-level queries, indexing, aggregation | Larger lines; needs schema discipline |
| Free text | Easy to write, human-friendly | Regex parsing; brittle queries |
| Index every field (full-text engine) | Any ad hoc search is fast | Indexing CPU and storage grow with every field; mapping conflicts |
| Columnar store, index hot fields only | Cheap storage, fast aggregations | Rare-field queries scan more data |
| Schema on write | Predictable queries | Type conflicts drop or reject events |
| Schema on read | Producers never blocked | Types resolved at query time; more query complexity |
| Keep all DEBUG logs | Maximum forensic detail | Volume and cost explode |
| Sample or drop low-severity logs | Bounded cost | Missing context for rare bugs |
| Long hot retention | Fast search over history | Storage cost; larger breach surface |

Uber's experience shows why the indexing choice dominates cost. Its Elasticsearch deployment indexed fields up to three levels deep, yet only about 5% of indexed fields were ever queried, and over 80% of queries were aggregations, a shape columnar stores handle better than inverted indexes.[^7]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Uber log ingest (2021) | Millions of logs/s from thousands of services, several PB stored[^7] |
| Uber ELK footprint before migration | 20+ Elasticsearch clusters and 50+ Logstash pipelines per region[^7] |
| One hour of Uber logs | About 1.3 TB; 6-hour dashboard queries often timed out on ELK[^7] |
| Share of indexed fields ever queried | About 5%[^7] |
| ClickHouse single-node ingest (Uber test) | 300K logs/s, about 10x one Elasticsearch node[^7] |
| Compression in the new store | 3x typical, up to 30x[^7] |
| Hardware cost after migration | Cut by more than half[^7] |
| Ingestion latency target | Under one minute[^7] |
| OpenTelemetry severity scale | 24 values in six bands[^1] |

## Failure modes

- **Mapping explosion and type conflicts.** A field that is a number in one service and a string in another collides in a schema-on-write index. Elasticsearch drops the conflicting logs, and mapping explosions or heavy queries could freeze Uber's clusters until restarted.[^7] Defend with a shared field registry, namespaced attributes, or a schema-on-read store.
- **Secrets and personal data in logs.** OWASP lists session IDs, access tokens, passwords, encryption keys, payment card data, connection strings and sensitive personal data as things to remove, mask, hash or encrypt.[^8] Redact in the library and again in the pipeline.
- **Log injection.** User input containing CR/LF can forge extra log lines. OWASP calls for sanitizing all event data, limiting the size of user input, and notes that parameterized logging alone does not stop CR/LF injection.[^8]
- **Tampering.** An attacker who gets in will try to erase traces. Build in tamper detection, copy logs to read-only media quickly, restrict and review read access, and log access to the logs themselves.[^8]
- **Clock skew.** Events from different hosts sort wrongly when clocks drift. Synchronize time across servers; where impossible, record the offset or a confidence level.[^8] Keeping both source and observed timestamps helps.[^1]
- **Lost lines on crash.** Buffered in-process writers lose their tail when a process dies; writing unbuffered to stdout, as Twelve-Factor recommends, avoids most of that loss.[^4]
- **Cost runaway during incidents.** Error storms multiply volume exactly when the pipeline is under most stress. Rate-limit repeated messages and give the pipeline a buffer that degrades by dropping DEBUG first.

## In the real world

- **Uber** ran ELK from 2014, then moved to a schema-agnostic platform on ClickHouse: each log is flattened into key-value arrays grouped by type, raw logs are kept in a `_source` column, and frequently queried fields are materialized into dedicated columns in the background.[^7] A QueryBridge service translated existing Kibana queries during migration, when about 10K dashboards were being saved each month.[^7]
- **Google Cloud Logging** reads structured JSON from stdout on GKE, Cloud Run and App Engine, and links entries to traces through `logging.googleapis.com/trace` and `spanId`.[^2]
- **OpenTelemetry** defines the log data model so logs, traces and metrics share resource and trace identifiers.[^1]
- **Elastic Stack** (Elasticsearch, Logstash, Kibana, Beats) pitches itself as taking data from any source, in any format, then searching, analyzing and visualizing it.[^6]

## In a design interview

Logging rarely gets its own question, but it comes up in every "how would you operate this?" follow-up. A short skeleton:

1. **Emit:** "Structured JSON to stdout, with service, version, severity, request ID and trace ID on every line."
2. **Ship and process:** "A node agent forwards to a processing tier that parses, enriches with metadata and redacts secrets, behind a buffer."
3. **Store:** "Hot store for 7–14 days for search, cheap object storage for long-term audit."
4. **Control cost:** "Drop or sample DEBUG in production, index only fields people query."

Interviewers probe: *How do you find all logs for one failing request across ten services?* (Propagated trace ID.) *What about PII?* (Redaction plus access control.) *What if the logging backend is down?* (Buffer, never block the request path.) *Logs or metrics for alerting?* (Metrics for alerting, logs for diagnosis.)

## Check yourself

> [!question]- Why do many teams prefer the app to write to stdout instead of managing log files?
> It keeps routing and storage out of application code. The platform captures, merges and forwards streams, so destinations can change without a deploy, and unbuffered writes are not lost when the process crashes.

> [!question]- Your Elasticsearch log cluster drops some events with mapping errors. What is happening?
> Two producers sent the same field name with different types, and the index rejected the conflicting documents. Fix with field naming conventions, namespacing, or a store that resolves types at query time.

> [!question]- Why is parameterized logging not enough to prevent log injection?
> It separates message from data but does not escape characters like CR/LF inside the data. An attacker can still inject fake lines unless values are encoded or sanitized.

## Further reading

- 📝 [XI. Logs](https://12factor.net/logs) — the short, influential case for treating logs as event streams.
- 📄 [Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) — the vendor-neutral schema for log records and severities.
- 📄 [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — what to log, what never to log, and how to protect logs.
- 📝 [Fast and Reliable Schema-Agnostic Log Analytics Platform](https://www.uber.com/blog/logging/) — a detailed migration story from ELK to ClickHouse.

## Related

- [[Metrics (Deep Dive)]] — aggregated numbers for alerting; logs explain the cause.
- [[Distributed Tracing (Deep Dive)]] — trace IDs in log lines stitch requests together.
- [[Microservices (Deep Dive)]] — more services means more streams to correlate.
- [[Message Queues (Deep Dive)]] — the buffer between shippers and storage.
- [[NoSQL Databases (Deep Dive)]] — search indexes and columnar stores behind log platforms.
- [[AI Monitoring & Observability (Deep Dive)]] — logging prompts, outputs and model versions.

> [!nav] Keep going
> ← [[Encryption (Deep Dive)|Encryption]] · [[Observability|🔭 Observability]] · [[Metrics (Deep Dive)|Metrics]] →
> 🌱 Back to the basics: [[Logging]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) — OpenTelemetry specification. Official docs. Checked 2026-11.
[^2]: 📄 [Structured logging](https://docs.cloud.google.com/logging/docs/structured-logging) — Google Cloud Logging documentation. Official docs. Checked 2026-11.
[^3]: 📄 [Observability primer](https://opentelemetry.io/docs/concepts/observability-primer/) — OpenTelemetry documentation. Official docs. Checked 2026-11.
[^4]: 📝 [XI. Logs](https://12factor.net/logs) — The Twelve-Factor App. Article. Checked 2026-11.
[^5]: 📄 [Logstash](https://www.elastic.co/docs/reference/logstash) — Elastic documentation. Official docs. Checked 2026-11.
[^6]: 📄 [The Elastic Stack](https://www.elastic.co/elastic-stack) — Elastic. Official docs. Checked 2026-11.
[^7]: 📝 [Fast and Reliable Schema-Agnostic Log Analytics Platform](https://www.uber.com/blog/logging/) — Uber Engineering, 2021. Engineering blog. Checked 2026-11.
[^8]: 📄 [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
