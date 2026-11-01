---
aliases: [Data Engineering & Pipelines deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Data Engineering & Pipelines]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Data Engineering & Pipelines]] › 🔬 Deep Dive

> [!tldr] For engineers
> An ML data platform is an **immutable, replayable log of raw events** plus batch and streaming jobs that validate, transform and serve that data to training and to online inference. The core trade-off is **correctness vs. latency vs. cost**, and the defining risk is silent failure: stale tables, schema drift and skew degrade models without throwing a single error. Design for idempotent reruns, explicit event time, and validation gates before data reaches a model.

> [!basics]- New to this? Start with the basics
> [[Data Engineering & Pipelines]] explains it with no jargon.

## How it really works

Every ML data path answers four questions: **how data gets in**, **where the source of truth lives**, **when and how it is transformed**, and **how it is checked before a model sees it**.

### The reference path

Uber's Michelangelo is a clean template. Transactional and log data lands in an HDFS data lake, queried with Spark and Hive SQL by scheduled jobs. For online use, features are precomputed into Cassandra, either by **batch precompute** from HDFS (a restaurant's average meal prep time over 7 days) or by **near-real-time** Kafka and Samza streaming jobs (the same metric over the last hour).[^1]

### Ingestion: the log as the backbone

Kafka models ingestion as an append-only, partitioned log. Topics are split across brokers so clients read and write in parallel; events with the same key land in the same partition and are read in exactly the order written.[^2] A common production setup uses a **replication factor of 3**.[^2] Crucially, events are **not deleted after consumption**: retention is a per-topic setting and performance is effectively constant with respect to data size, so keeping weeks of history is practical.[^2] That retention is what makes a pipeline **replayable**: a fixed job can re-read the log and recompute its outputs, and producers and consumers stay fully decoupled.[^2]

### Batch, streaming and time

Apache Beam treats both styles as one model. A **bounded** collection has a fixed size (batch); an **unbounded** one grows forever and is processed as elements arrive (streaming).[^3] Grouping an infinite stream needs **windows** (fixed, sliding, session or global), a **watermark** that guesses when all data for a window has arrived, and **triggers** that decide when to emit results. Elements arriving after the watermark passes the window's end are **late data**, kept only within the allowed lateness.[^3]

The Dataflow paper that underpins Beam argues the mental shift: you never know whether you have seen all your data, so a pipeline must let you choose a point on the **correctness, latency and cost** curve.[^4] It frames every pipeline as four questions: *what* is computed, *where* in **event time** (when things happened, not when they were processed), *when* in processing time results are materialized, and *how* later refinements relate to earlier results.[^4]

```python
# Beam sketch: per-user click counts in 1-minute event-time windows,
# accepting events up to 10 minutes late.
(clicks
 | beam.WindowInto(window.FixedWindows(60), allowed_lateness=600)
 | beam.Map(lambda e: (e["user_id"], 1))
 | beam.CombinePerKey(sum))
```

### ETL vs. ELT

ETL transforms on a separate processing server before loading; ELT loads raw data into the warehouse or lake and transforms it there.[^5] ETL has existed since the 1970s and suits structured, tabular data; ELT handles structured, semi-structured and unstructured data and uses the warehouse's parallelism, which is why it became the default once cloud storage made keeping raw data cheap.[^5] Privacy differs too: ETL teams build custom steps such as masking personal data, while ELT leans on the warehouse's built-in, granular access control.[^5]

### Orchestration and idempotency

Schedulers such as Airflow retry failed tasks, so every task must be safe to rerun. Airflow's guidance: treat tasks like database transactions that never publish partial results, make every rerun produce the same outcome, replace `INSERT` with `UPSERT`, never read "the latest available data", and never use the current time for critical logic. Partition work by the run's logical interval (`data_interval_start`) instead.[^6]

```sql
-- Idempotent daily load: rerunning a day overwrites it, never duplicates it.
DELETE FROM clean_events WHERE event_date = '{{ ds }}';
INSERT INTO clean_events
SELECT * FROM raw_events WHERE event_date = '{{ ds }}' AND user_id IS NOT NULL;
```

### Validation gates

Google's data-validation system, part of TFX, checks data entering ML pipelines and is used by hundreds of product teams to watch **several petabytes of production data per day**.[^7] Its open-source form, TensorFlow Data Validation (TFDV), compares batch statistics against a **schema** of expected types and values. The schema can be inferred from training data, but only best-effort, so engineers review it.[^8] TFDV flags **distribution skew** (feature values in training differ significantly from serving) and **drift** between consecutive spans, measured with L-infinity distance for categorical features and approximate Jensen-Shannon divergence for numeric ones, against thresholds you tune.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Batch only | Simple, cheap, easy to backfill and reason about | Data is hours old; useless for real-time signals |
| Streaming only, replay from a retained log | One codebase; fresh results; reprocess by replaying the log | Needs event-time windowing, watermarks and late-data handling |
| Separate batch and speed layers ("Lambda") | Fresh approximate results plus exact batch results | Two systems to build and keep in sync, which the Dataflow paper calls a failure on simplicity[^4] |
| ETL | Only clean, structured data lands in the target | Up-front planning; an extra transformation tier that is hard to scale[^5] |
| ELT | Raw data kept; transform later with warehouse compute | Raw sensitive data lands first; warehouse cost |
| Schema validation as a hard gate | Bad data never reaches training | False alarms block pipelines; thresholds need tuning[^8] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Share of a mature ML system that is ML code | At most about 5%, with at least 95% glue code[^9] |
| LinkedIn Kafka, March 2015 | 800B+ messages/day, 13M+ messages/s peak, 175 TB in and 650 TB out per day, 1,100+ brokers in 60+ clusters[^10] |
| LinkedIn Kafka, September 2015 | 1 trillion+ published messages/day; each consumed by about 4 applications[^11] |
| Common Kafka replication factor | 3 copies[^2] |
| Google data validation scale | Several petabytes/day, hundreds of product teams[^7] |
| Cost of one stale table at Google Play | Stale for 6 months; refreshing it gave +2% install rate[^12] |
| Uber online features | ~10,000 shared features, refreshed daily[^1] |

The LinkedIn ratio is the useful one for sizing: consumed bytes ran nearly 4× produced bytes, because each topic has multiple consumers.[^10]

## Failure modes

- **Silent staleness.** A job stops updating a table and nothing crashes. Google Play's six-month stale table is the canonical example.[^12] Defend with freshness checks on every output and alerts on row counts.
- **Unstable upstream data.** A signal owned by another team changes behavior, even as an "improvement", and a model fitted to the old version breaks. The mitigation is a **versioned copy** of the input, frozen until the new version is vetted.[^9]
- **Underutilized data dependencies.** Legacy or barely useful inputs keep the pipeline fragile: Sculley et al. describe a model still reading an old product-number field the day the code populating it is deleted.[^9] Prune with regular leave-one-feature-out evaluations.[^9]
- **Pipeline jungles.** Scrapes, joins and sampling steps accrete into a tangle that is hard to test and to recover from failure.[^9] The fix is a holistic redesign of data collection and feature extraction.[^9]
- **Late and out-of-order events.** Processing-time windows miscount when mobile clients upload hours late. Use event-time windows, watermarks and allowed lateness.[^3]
- **Non-idempotent reruns.** A retried `INSERT` doubles a day of data. Use upserts or partition overwrites keyed on the logical date.[^6]
- **Schema and distribution changes.** A new enum value or a units change shifts feature distributions. Gate on schema and skew checks before training.[^8]

## In the real world

- **LinkedIn** runs Kafka as separate clusters for queuing, metrics, logging and tracking; tracking events feed Samza stream jobs and Hadoop batch jobs.[^10] An engineer there called Kafka the company's "circulatory system" for data.[^11]
- **Uber Michelangelo** pairs an HDFS lake (Spark, Hive) for training data with Kafka and Samza streams and a Cassandra serving store.[^1]
- **Google TFX** validates data on every pipeline run and open-sourced the component as TFDV.[^7][^8]
- **Apache Beam** pipelines run on Google Cloud Dataflow, Apache Flink or Apache Spark through interchangeable runners.[^3]

## In a design interview

Draw the path left to right, then defend each hop:

1. **Ingest:** "Clickstream and CDC events go to Kafka, keyed by user so per-user order holds; 7-day retention lets us replay."
2. **Land:** "A connector writes raw, date-partitioned files to object storage; that is the immutable source of truth."
3. **Transform:** "Nightly Spark or SQL jobs build training tables; a streaming job computes 1-hour aggregates for online features."
4. **Validate:** "Schema and distribution checks gate the training job; failures page the owner instead of training on bad data."
5. **Serve:** "Batch outputs to the warehouse for training; latest values to a key-value store for inference."

Interviewers probe: *How do you backfill a bug fix?* (Replay from the raw zone; idempotent, partitioned jobs.) *Late data?* (Event time, watermarks, allowed lateness.) *How do you know data is wrong before the model does?* (Freshness, volume, schema and drift checks.) *Why not stream everything?* (Cost and complexity; only freshness-critical signals stream.)

## 🧱 Builds on

- [[Message Queues]] — a partitioned, replicated, retained log with per-partition ordering and consumer offsets, which gives fan-out to many consumers and replay for reprocessing.
- [[Object Storage]] — the immutable raw zone, partitioned by date, that every downstream table can be rebuilt from.
- [[SQL Databases]] — sources for change-data extraction, and the warehouse engine in which ELT transformations run as SQL.
- [[NoSQL Databases]] — wide-column and key-value stores such as Cassandra that serve precomputed values by key in milliseconds.

## Check yourself

> [!question]- Why does a retained log like Kafka make pipelines easier to fix than a classic queue that deletes messages on read?
> Because events stay after consumption, a corrected job can re-read the same history and rebuild its outputs. Multiple consumers can also read the same stream independently, so a new pipeline can start from the beginning without touching existing ones.

> [!question]- A mobile app buffers events offline and uploads them hours later. What goes wrong with processing-time windows, and what fixes it?
> Events are counted in the window when they arrived, not when they happened, so hourly metrics are wrong. Window on event time, let the watermark track completeness, and set allowed lateness so late events update the right window.

> [!question]- A daily job failed halfway and was retried. Training data now has duplicate rows for that day. What design rules were broken?
> The task was not idempotent: it published partial results and used plain inserts. Each run should write a whole partition for its logical date atomically, by overwrite or upsert, so reruns produce the same result.

## Further reading

- 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — the classic on data dependencies, glue code and pipeline jungles.
- 🔬 [The Dataflow Model](https://www.vldb.org/pvldb/vol8/p1792-Akidau.pdf) — event time, windows and triggers from the team behind Google Cloud Dataflow.
- 📄 [Basics of the Beam model](https://beam.apache.org/documentation/basics/) — a compact glossary of windows, watermarks and triggers.
- 📄 [Airflow best practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html) — idempotent tasks and reproducible reruns in practice.
- 📝 [Meet Michelangelo](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — how Uber wired batch and streaming data into one ML platform.

## Related

- [[Feature Engineering (Deep Dive)]] — point-in-time joins and online/offline consistency built on these pipelines.
- [[Message Queues (Deep Dive)]] — partitions, offsets and delivery guarantees.
- [[Data Sources (Deep Dive)]] — what feeds the pipeline.
- [[MLOps & CI-CD (Deep Dive)]] — versioning and automating data and models together.
- [[AI Monitoring & Observability (Deep Dive)]] — drift and data-quality monitoring in production.

> [!nav] Keep going
> ← [[Cloud & Infrastructure (Deep Dive)|Cloud & Infrastructure]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Model Selection & Training (Deep Dive)|Model Selection & Training]] →
> 🌱 Back to the basics: [[Data Engineering & Pipelines]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^2]: 📄 [Introduction](https://kafka.apache.org/intro) — Apache Kafka documentation. Official docs. Checked 2026-11.
[^3]: 📄 [Basics of the Beam model](https://beam.apache.org/documentation/basics/) — Apache Beam documentation. Official docs. Checked 2026-11.
[^4]: 🔬 [The Dataflow Model](https://www.vldb.org/pvldb/vol8/p1792-Akidau.pdf) — Akidau et al., Google, VLDB 2015. Paper. Checked 2026-11.
[^5]: 📄 [What's the Difference Between ETL and ELT?](https://aws.amazon.com/compare/the-difference-between-etl-and-elt/) — Amazon Web Services. Official docs. Checked 2026-11.
[^6]: 📄 [Best Practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html) — Apache Airflow documentation. Official docs. Checked 2026-11.
[^7]: 🔬 [Data Validation for Machine Learning](https://research.google/pubs/data-validation-for-machine-learning/) — Breck et al., Google Research, SysML 2019. Paper. Checked 2026-11.
[^8]: 📄 [TensorFlow Data Validation](https://www.tensorflow.org/tfx/guide/tfdv) — TensorFlow TFX guide. Official docs. Checked 2026-11.
[^9]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., Google, NeurIPS 2015, sections 3 and 5. Paper. Checked 2026-11.
[^10]: 📝 [Running Kafka At Scale](https://engineering.linkedin.com/kafka/running-kafka-scale) — LinkedIn Engineering, March 2015. Engineering blog. Checked 2026-11.
[^11]: 📝 [How We're Improving and Advancing Kafka at LinkedIn](https://engineering.linkedin.com/apache-kafka/how-we_re-improving-and-advancing-kafka-linkedin) — LinkedIn Engineering, September 2015. Engineering blog. Checked 2026-11.
[^12]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, Rule #10. Official docs. Checked 2026-11.
