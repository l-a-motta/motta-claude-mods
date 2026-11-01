---
aliases: [Data Sources deep dive]
tags: [level/deep-dive, part/2, section/ai-building-blocks]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Building Blocks]]"
basics: "[[Data Sources]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Building Blocks]] › [[Data Sources]] › 🔬 Deep Dive

> [!tldr] For engineers
> Data sources set the ceiling on model quality, and each one differs in **structure, freshness, ownership and label availability**. The engineering job is to pull from them without hurting the systems of record (change data capture, not polling), land everything raw and replayable, document what each dataset is, and feed training and serving from the **same definitions** so the model sees in production what it saw in training.

> [!basics]- New to this? Start with the basics
> [[Data Sources]] explains it with no jargon.

## How it really works

Every source answers four questions: **what shape is the data**, **how fresh must it be**, **who owns it**, and **where do the labels come from**. The answers decide the ingestion method.

### Operational databases

The tables behind the product (orders, users, tickets) are usually the richest first-party source. There are three ways to read them:

- **Snapshots.** A periodic bulk export. Simple and consistent, but stale between runs and heavy on the source while it runs.
- **Polling.** Query rows `WHERE updated_at > :last_seen`. It needs a "last updated" column, burns CPU on every poll, and never sees deletes.
- **Change data capture (CDC).** Read the database's own change stream. Debezium, an open-source set of Kafka Connect source connectors, uses each database's native CDC features to capture every change, including deletes, with millisecond-range delay for MySQL and PostgreSQL, no schema changes, and none of the CPU cost of frequent polling.[^1] It can also emit the old row state and metadata such as the transaction ID.[^1]

CDC has a sharp edge: databases discard transaction logs once recovery and replication no longer need them, so a connector that falls too far behind must take a fresh snapshot.[^1]

### Event streams

Clickstreams, payments and telemetry arrive as **events**: a key, a value, a timestamp and optional headers.[^2] Kafka stores them in **topics** split into **partitions**; events with the same key land in the same partition and are read in write order.[^2] Two properties matter for ML. Events are **not deleted when consumed**, and retention is configurable per topic, so a new model can replay history to build training data.[^2] Producers never wait for consumers, so a slow training job cannot back-pressure the product.[^2]

### Files, lakes and public corpora

Logs, documents, images and exports land in a **data lake**: one store for structured and unstructured data at any scale, with the schema applied when the data is read, not when it is captured.[^3] Public corpora are the extreme case. Common Crawl publishes raw pages, metadata and text extracts collected since 2008, petabytes in total, free to read on AWS.[^4]

### Devices

IoT fleets push telemetry through a broker. AWS IoT Core, for example, accepts MQTT, MQTT over secure WebSockets, HTTPS and LoRaWAN, and routes messages onward with rules.[^5] Device data is high-volume, bursty and often arrives late or out of order.

### Labels

Supervised models need a target. **Direct labels** match the prediction exactly; **proxy labels** only approximate it ("recently bought a bike" for "owns a bike").[^6] Labels come from human raters, who are flexible but cost money and make mistakes, or from software, including other models.[^6] Google's crash course suggests labeling a sample of about 1,000 examples yourself to audit raters.[^6]

### Offline and online paths

Production systems usually run two paths from the same sources. Uber's Michelangelo is the textbook case: transactional and log data flows into an HDFS data lake for batch training; Kafka metrics feed Samza jobs that compute near-real-time aggregates; and features are precomputed into Cassandra for low-latency reads at prediction time.[^7] An UberEATS delivery-time model mixes a daily batch feature ("average meal preparation time over the last seven days") with a streaming one-hour average.[^7]

### Documenting what you ingest

A source without documentation is a liability. *Datasheets for Datasets* proposes that every dataset ship with a record of its motivation, composition, collection process and recommended uses, by analogy with electronic component datasheets.[^8] A lightweight version lives next to the pipeline code:

```yaml
source: support_tickets
owner: support-platform-team
ingestion: cdc            # debezium -> kafka topic tickets.cdc
freshness_slo: 5m
retention: 400d
pii: [customer_email, phone]
labels: resolution_category  # direct label, set by agents at close
collection_notes: "English and Spanish queues only before 2025-03"
recommended_uses: [routing, deflection]
not_for: [agent performance reviews]
```

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Snapshot export | Simple, consistent point in time | Stale between runs; load spikes on the source |
| Polling on `updated_at` | No extra infrastructure | Misses deletes; needs a schema column; constant query load |
| Log-based CDC | Every change, including deletes; low delay | Another system to run; log-retention edge cases |
| Batch features | Cheap, easy to backfill | Hours of staleness |
| Streaming features | Seconds of freshness | Harder to backfill and debug; must match the batch definition |
| First-party data | Matches your users and task | Limited volume; privacy duties |
| Public or purchased data | Volume and coverage | Quality, licensing and contamination risk |
| Human labels | Handle hard, subjective tasks | Cost, rater error, slow |
| Automatic or proxy labels | Cheap at scale | Can drift from what you actually want to predict |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Common Crawl corpus | Petabytes, collected since 2008[^4] |
| GPT-3 web input before and after filtering | 45 TB compressed text → 570 GB, about 400B tokens, from 41 monthly shards (2016–2019)[^9] |
| GPT-3 training mix | Filtered Common Crawl 410B tokens at 60% weight; Wikipedia 3B tokens at 3%[^9] |
| Epochs over each source in GPT-3 (300B tokens) | Common Crawl 0.44; Wikipedia 3.4[^9] |
| Rough data-size rule of thumb | 10× to 100× more examples than trainable parameters[^10] |
| Michelangelo feature store (2017) | About 10,000 features, refreshed daily[^7] |
| Debezium change latency (MySQL, PostgreSQL) | Millisecond range[^1] |
| Data cascades in high-stakes AI | 92% prevalence among 53 practitioners interviewed[^11] |

The GPT-3 mix is the key lesson: sources were weighted by **quality, not size**, so smaller curated sets were seen several times while most of the web crawl was seen less than once.[^9]

## Failure modes

- **Data cascades.** Sambasivan et al. define them as compounding downstream effects of data issues: pervasive, invisible and delayed.[^11] Defend with source owners, datasheets and data-quality checks at ingestion, not just model metrics.
- **Unreliable records.** Omitted values, duplicates, bad feature values and bad labels.[^10] Flag them automatically; when imputing a missing value, add an indicator column such as `temperature_is_imputed` so the model can tell real from filled.[^10]
- **Training-serving skew.** A joined table changes between training and serving, so the model sees different values live.[^12] Google's *Rules of ML* advises logging the features used at serving time and reusing code between the training and serving pipelines.[^12]
- **Benchmark contamination.** Web-scale sources leak test sets into training data. GPT-3's team tried to remove overlaps, but a filtering bug left some, and retraining was too expensive.[^9]
- **Lost changes.** Polling silently misses deletes; CDC connectors that lag past log retention need a resnapshot.[^1]
- **Data swamp.** A lake without cataloging, governance and access control fills with data nobody can find or trust.[^3]
- **Proxy drift.** A proxy label is only as good as its link to the real target.[^6] Re-check the link when the product changes.

## In the real world

- **Uber Michelangelo** combined an HDFS lake, Kafka and Samza streams, Cassandra for low-latency online features, and a shared feature store.[^7]
- **OpenAI GPT-3** drew most of its tokens from filtered Common Crawl and up-weighted curated books, WebText2 and Wikipedia.[^9]
- **Debezium on Kafka** is a common open-source CDC stack for streaming database changes into ML pipelines.[^1][^2]
- **AWS IoT Core** is a typical managed entry point for device telemetry.[^5]

## In a design interview

Treat sources as a requirement, not a footnote. A strong answer walks through:

1. **Inventory:** "Orders and tickets from Postgres, clickstream from the web app, a third-party fraud score via API."
2. **Freshness per signal:** "Fraud needs last-five-minutes velocity, so that comes from the stream; lifetime spend can be a daily batch."
3. **Ingestion:** "CDC from Postgres into Kafka, so deletes and refunds are not missed; raw events retained for replay."
4. **Labels:** "Chargebacks are the direct label but arrive weeks late; use analyst reviews as an earlier proxy."
5. **Quality and governance:** "Schema checks at ingestion, PII tagged, a datasheet per dataset."

Interviewers probe: *How do you backfill a new feature?* (Replay retained events or recompute from the lake.) *How do you keep online and offline features consistent?* (One definition, logged serving features.) *What if the third-party API is down?* (Cache, default value, and train the model to tolerate the missing feature.)

## 🧱 Builds on

- [[Databases (Deep Dive)]] — CDC reads the database's transaction log, the same log that powers recovery and replication.
- [[API Design (Deep Dive)]] — third-party sources bring rate limits, pagination and versioned schemas into the pipeline.
- [[Message Queues (Deep Dive)]] — partitioned, retained logs give ordering per key and replay for retraining.
- [[Object Storage (Deep Dive)]] — the lake's raw zone is object storage, cheap enough to keep every version.

## Check yourself

> [!question]- Why prefer log-based CDC over polling an `updated_at` column for training data?
> Polling misses deletes, needs a schema column and adds constant query load. CDC captures every change, including deletes, with low delay and no polling cost, at the price of running connectors and handling log-retention gaps.

> [!question]- GPT-3 saw Wikipedia 3.4 times but Common Crawl only 0.44 times. Why sample that way?
> Sources were weighted by quality, not size. The curated sets were repeated to raise average quality, accepting a little overfitting, while the noisier web crawl was undersampled.

> [!question]- A fraud model scores well offline but poorly in production. Which data-source issue do you suspect first?
> Training-serving skew: features computed differently, or from tables that changed, between the offline and online paths. Log serving-time features and compare them with the training values.

## Further reading

- 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — still the clearest picture of offline and online data paths feeding one platform.
- 📄 [Debezium features](https://debezium.io/documentation/reference/stable/features.html) — a short, concrete case for log-based CDC over polling and dual writes.
- 🔬 [Datasheets for Datasets](https://arxiv.org/abs/1803.09010) — the standard template for documenting where a dataset came from and what it is for.
- 🔬 [Data Cascades in High-Stakes AI](https://research.google/pubs/everyone-wants-to-do-the-model-work-not-the-data-work-data-cascades-in-high-stakes-ai/) — field evidence of how data problems compound.
- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Google's practical rules, including the ones on training-serving skew.

## Related

- [[Data Engineering & Pipelines (Deep Dive)]] — moving, validating and transforming what these sources produce.
- [[Feature Engineering (Deep Dive)]] — feature stores and online/offline consistency.
- [[AI Security & Privacy (Deep Dive)]] — PII handling and consent for collected data.
- [[Evaluation & Metrics (Deep Dive)]] — why contaminated sources inflate benchmark scores.
- [[Retrieval-Augmented Generation (Deep Dive)]] — documents as a live source at answer time.

> [!nav] Keep going
> ← [[AI Architecture Layers (Deep Dive)|AI Architecture Layers]] · [[AI Building Blocks|🧩 AI Building Blocks]] · [[AI Model Types (Deep Dive)|AI Model Types]] →
> 🌱 Back to the basics: [[Data Sources]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Debezium Features](https://debezium.io/documentation/reference/stable/features.html) — Debezium documentation. Official docs. Checked 2026-11.
[^2]: 📄 [Introduction](https://kafka.apache.org/intro) — Apache Kafka documentation. Official docs. Checked 2026-11.
[^3]: 📄 [What is a Data Lake?](https://aws.amazon.com/what-is/data-lake/) — Amazon Web Services. Official docs. Checked 2026-11.
[^4]: 📄 [Overview](https://commoncrawl.org/overview) — Common Crawl Foundation. Official docs. Checked 2026-11.
[^5]: 📄 [What is AWS IoT?](https://docs.aws.amazon.com/iot/latest/developerguide/what-is-aws-iot.html) — AWS IoT Core Developer Guide. Official docs. Checked 2026-11.
[^6]: 🎓 [Datasets, generalization, and overfitting: Labels](https://developers.google.com/machine-learning/crash-course/overfitting/labels) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^7]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Del Balso and Hermann, Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^8]: 🔬 [Datasheets for Datasets](https://arxiv.org/abs/1803.09010) — Gebru et al., Communications of the ACM, 2021. Paper. Checked 2026-11.
[^9]: 🔬 [Language Models are Few-Shot Learners (PDF)](https://arxiv.org/pdf/2005.14165) — Brown et al., OpenAI, 2020, section 2.2 and Table 2.2. Paper. Checked 2026-11.
[^10]: 🎓 [Datasets, generalization, and overfitting: Data characteristics](https://developers.google.com/machine-learning/crash-course/overfitting/data-characteristics) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^11]: 🔬 ["Everyone wants to do the model work, not the data work": Data Cascades in High-Stakes AI](https://research.google/pubs/everyone-wants-to-do-the-model-work-not-the-data-work-data-cascades-in-high-stakes-ai/) — Sambasivan et al., Google Research, ACM SIGCHI 2021. Paper. Checked 2026-11.
[^12]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Google for Developers. Official docs. Checked 2026-11.
