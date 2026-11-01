---
aliases: [Message Queues deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/reliability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Reliability]]"
basics: "[[Message Queues]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Reliability]] › [[Message Queues]] › 🔬 Deep Dive

> [!tldr] For engineers
> A queue **decouples producers from consumers in time, rate and failure**. Two families dominate: work queues (SQS, RabbitMQ) that track each message and delete it on acknowledgement, and partitioned logs (Kafka) that retain events and let each consumer group track an offset. Nearly everything is at-least-once by default, so design idempotent consumers, bound retries with a dead-letter queue, and alert on backlog age.

> [!basics]- New to this? Start with the basics
> [[Message Queues]] explains it with no jargon.

## How it really works

Every broker answers four questions: **how messages are routed**, **when a message counts as done**, **what order is guaranteed**, and **what happens to a message that keeps failing**.

### Work queues: per-message state, delete on ack

In RabbitMQ (AMQP 0-9-1), publishers never write to a queue directly. They publish to an **exchange**, which copies the message into queues according to **bindings**.[^1] Exchange types set the routing: `direct` matches the routing key exactly, `fanout` copies to every bound queue and ignores the key, `topic` matches key patterns for pub/sub, and `headers` routes on header values.[^1]

Delivery ends with an acknowledgement. With **automatic ack**, the broker treats a message as done as soon as it is sent; with **explicit ack**, the consumer sends `basic.ack` when it chooses, ideally after processing.[^1] If a consumer dies without acking, the broker redelivers to another consumer.[^1] **Prefetch** caps how many unacked messages one consumer may hold, which balances load across workers.[^1]

Amazon SQS has the same shape with a lease instead of a connection. A received message stays in the queue but becomes invisible for the **visibility timeout** (default 30 seconds); the consumer must delete it before the timeout or it reappears for another consumer.[^2] Long jobs extend the lease with `ChangeMessageVisibility` as a heartbeat, up to 12 hours from first receipt.[^2]

An at-least-once worker loop, SQS-style:

```python
while True:
    for msg in queue.receive(max_messages=10):
        if seen(msg.dedup_key):          # idempotency guard
            queue.delete(msg)
            continue
        handle(msg.body)                 # may raise: message reappears after timeout
        record_seen(msg.dedup_key)
        queue.delete(msg)                # ack only after the side effect is durable
```

### Logs: retained events, consumer-owned offsets

Kafka stores events in **topics** split into **partitions** spread across brokers. Events with the same key always land in the same partition, and a consumer reads each partition in exactly the order it was written.[^3] Reading does not delete anything: each topic keeps events for a configurable retention period, and partitions are replicated, commonly with a replication factor of 3.[^3]

Consumers **pull**. That lets a consumer that fell behind catch up and lets it batch whatever is available after its position.[^4] Consumers sharing a `group.id` form a **consumer group**; each partition is consumed by exactly one member of the group at a time, so partitions are the unit of parallelism.[^4] A consumer's state is just an integer **offset** per partition, checkpointed to the internal `__consumer_offsets` topic.[^4] After a rebalance, the new owner resumes from the last committed offset, so anything processed but not yet committed is processed again.[^4]

Jay Kreps described a topic as a **sharded write-ahead log**: producers append, consumers read from their own offsets, and one shared log serves any number of consumers instead of one queue copy per consumer.[^5]

### Delivery semantics

- **At-most-once:** no retries, so messages can be lost but never duplicated.[^6]
- **At-least-once:** retry on a missing ack, so a message can be written or delivered twice.[^6]
- **Exactly-once:** retries still yield one delivery to the end consumer; it needs cooperation between broker and application.[^6]

On the consumer side, the choice is where you commit. Mark consumed before processing and a crash loses the message; mark after processing and a crash causes a redelivery.[^4]

Kafka's **idempotent producer** (`enable.idempotence=true`) tags each batch with a sequence number the broker uses to drop resends, and the sequence state is persisted in the replicated log so a new leader still catches duplicates.[^6] **Transactions** add atomic writes across partitions and can commit consumer offsets in the same transaction, while consumers set `isolation.level=read_committed` to hide aborted data.[^6] The guarantee stops at Kafka's edge: side effects such as calls to external services are not covered.[^6] SQS FIFO queues offer **exactly-once processing** within the queue by deduplicating on `MessageDeduplicationId` or on content.[^7]

### Ordering

SQS standard queues are best-effort ordered; FIFO queues order strictly **within a message group**, and different groups run in parallel.[^7] Kafka orders within a partition, not across a topic.[^3] In both, global order costs parallelism: you scale by adding groups or partitions, each with its own order.

### Poison messages and dead-letter queues

An SQS **redrive policy** sets `maxReceiveCount`, the number of receives before a message moves to the **dead-letter queue (DLQ)**.[^8] Set it high enough to ride out transient errors.[^8] Engineers inspect the DLQ, fix the bug and redrive the messages back.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Work queue (SQS, RabbitMQ) | Simple per-message ack; easy competing consumers | Message gone once acked; no replay; fan-out needs extra queues |
| Log (Kafka) | Replay; many independent consumer groups on one copy | Partition count caps a classic consumer group's parallelism; offset management |
| Standard queue | Nearly unlimited throughput[^7] | Duplicates and out-of-order delivery[^7] |
| FIFO queue | Order per group; deduplication[^7] | Lower throughput ceiling[^7] |
| Explicit ack after processing | No loss on consumer crash | Duplicates on crash; needs idempotency |
| Synchronous replication | Acked data survives a broker loss | Lower throughput (roughly half in Kafka's 2014 benchmark)[^5] |
| Pull consumers (Kafka) | Consumer sets its own pace, catches up after lag, batches freely[^4] | Consumers must poll; idle polls cost requests |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| SQS default visibility timeout | 30 s; max 12 h from first receive[^2] |
| SQS standard in-flight limit | About 120,000 messages[^2] |
| SQS FIFO throughput | 300 API calls/s per method; 3,000 msg/s with batches of 10; up to 30,000 TPS in high-throughput mode[^7] |
| Kafka on 3 commodity brokers (2014) | ~2 million writes/s with 3x async replication[^5] |
| Kafka single producer, 3x replication | 786,980 rec/s async vs. 421,823 rec/s sync[^5] |
| Kafka end-to-end latency (2014) | 2 ms median, 3 ms p99, 14 ms p99.9[^5] |
| Kafka transactions overhead (1 KB messages, 100 ms transactions) | ~3% vs. `acks=all` with one in-flight request[^6] |
| LinkedIn Kafka (2015) | 1 trillion+ msgs/day, 4.5 M/s peak, ~4 consumers per message[^9] |
| LinkedIn Kafka (team page, current) | 7 trillion+ msgs/day, 100+ clusters, 4,000+ brokers, 7 million partitions[^10] |

## Failure modes

- **Poison message.** One malformed message crashes every consumer that takes it and loops forever. Defend with `maxReceiveCount` and a DLQ, plus an alarm on DLQ depth.[^8]
- **Duplicate side effects.** At-least-once delivery plus a non-idempotent consumer charges a card twice. SQS warns that standard queues may deliver a message more than once and tells you to use idempotent operations.[^7] Store a dedup key alongside the side effect.
- **Visibility timeout set wrong.** Too short and a slow job reappears while still running, so two workers process it; too long and crashed jobs wait a long time before retry.[^2]
- **Lost messages with auto-ack.** With automatic ack the broker forgets the message the moment it is sent, so a consumer crash loses it.[^1]
- **Backlog that never drains.** If producers outpace consumers, age of the oldest message climbs without bound. Scale consumers, shed or sample low-value work, and alert on age, not just depth. SQS exposes `ApproximateAgeOfOldestMessage` for this.[^8]
- **DLQ retention trap.** For standard queues, expiry is based on the original enqueue time, so a message that sat a day in the source queue loses a day of DLQ retention. Make the DLQ retention longer than the source's.[^8]
- **Order broken by a DLQ.** Moving one message aside breaks the sequence; SQS advises against a DLQ on FIFO queues whose order must never break.[^8]
- **Hot partition.** All events for a key go to one partition,[^3] so one very busy key pins one consumer. Pick keys with enough spread, or split hot keys.
- **Rebalance replays.** A consumer crash or deploy reassigns partitions, and work since the last commit runs again.[^4]

## In the real world

- **LinkedIn** runs Kafka as its central data pipeline and the replication backbone for its Espresso database, and feeds Samza stream processing from it.[^9] Its current footprint is over 100 clusters and 100,000 topics.[^10]
- **Kafka's 2014 "lazy benchmark"** reached about 2 million writes per second on three cheap machines with default settings, and throughput stayed flat as stored data grew past a terabyte.[^5]
- **Amazon SQS** documents the classic uses: decoupling uploads from background resizing, spreading card-validation requests over worker nodes, and FIFO queues for price updates that must apply in order.[^7]
- **Confluent's** engineers document Kafka's idempotent producer, transactions and Kafka Streams' exactly-once mode, and are explicit that it covers only processing inside Kafka.[^6]
- **Apache Kafka 4.2** (2026) made **share groups** (KIP-932, "Queues for Kafka") production-ready: several consumers can process records from the same partition, with individual acknowledgement and delivery counting, so Kafka can also serve as a work queue.[^11]

## In a design interview

Introduce a queue whenever a request triggers slow or bursty work, or when one event must reach several services. Then answer the four questions:

1. **Model:** "SQS work queue for thumbnail jobs; a Kafka topic for order events because billing, search and analytics each read them."
2. **Guarantee:** "At-least-once; consumers dedupe on order ID."
3. **Order:** "Partition by order ID, so each order's events stay in sequence."
4. **Failure:** "Five attempts, then a DLQ with an alarm; alert on oldest-message age."

Interviewers probe: *What if consumers fall behind?* (Scale the group up to the partition count; shed low-priority work.) *Can you get exactly-once?* (Inside Kafka with transactions; across external systems, only with idempotent writes.) *How do you size partitions?* (Target throughput divided by per-consumer throughput, with headroom.)

## Check yourself

> [!question]- Your Kafka consumer group has 12 consumers but the topic has 8 partitions. What happens?
> In a classic consumer group, each partition goes to exactly one consumer, so 4 consumers sit idle. To scale further you need more partitions, or a share group, where several consumers can work the same partition.

> [!question]- Why can a message be processed twice even when nothing crashed?
> If processing outlasts the visibility timeout, the message becomes visible again and a second worker picks it up while the first is still running. Extend the lease with a heartbeat or raise the timeout.

> [!question]- When is a DLQ the wrong tool?
> When strict order matters, as in a FIFO stream of edits: pulling one message aside lets later messages run without it and changes the result.

## Further reading

- 📝 [Benchmarking Apache Kafka: 2 Million Writes Per Second](https://engineering.linkedin.com/kafka/benchmarking-apache-kafka-2-million-writes-second-three-cheap-machines) — the clearest short explanation of the log model, with real numbers.
- 📝 [Exactly-Once Semantics Are Possible: Here's How Kafka Does It](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) — delivery guarantees explained by the people who built them.
- 📄 [AMQP 0-9-1 Model Explained](https://www.rabbitmq.com/tutorials/amqp-concepts) — exchanges, bindings and acks in one page.
- 📄 [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) — the lease model with practical tuning advice.
- 📄 [Kafka Consumer Design](https://docs.confluent.io/kafka/design/consumer-design.html) — pull, consumer groups and offsets in detail.

## Related

- [[Microservices (Deep Dive)]] — async messaging between services.
- [[Fault Tolerance (Deep Dive)]] — retries, backoff and idempotency on the consumer side.
- [[Replication (Deep Dive)]] — how partition replicas keep acked data safe.
- [[Sharding (Deep Dive)]] — partitions are shards of a log.
- [[Rate Limiting (Deep Dive)]] — queues absorb bursts that limiters would reject.
- [[Data Engineering & Pipelines (Deep Dive)]] — streaming ingestion for AI systems.

> [!nav] Keep going
> ← [[Load Balancing (Deep Dive)|Load Balancing]] · [[Reliability|🛡️ Reliability]] · [[Fault Tolerance (Deep Dive)|Fault Tolerance]] →
> 🌱 Back to the basics: [[Message Queues]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [AMQP 0-9-1 Model Explained](https://www.rabbitmq.com/tutorials/amqp-concepts) — RabbitMQ documentation. Official docs. Checked 2026-11.
[^2]: 📄 [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) — Amazon SQS Developer Guide. Official docs. Checked 2026-11.
[^3]: 📄 [Introduction](https://kafka.apache.org/intro) — Apache Kafka documentation. Official docs. Checked 2026-11.
[^4]: 📄 [Kafka Consumer Design: Consumers, Consumer Groups, and Offsets](https://docs.confluent.io/kafka/design/consumer-design.html) — Confluent documentation. Official docs. Checked 2026-11.
[^5]: 📝 [Benchmarking Apache Kafka: 2 Million Writes Per Second (On Three Cheap Machines)](https://engineering.linkedin.com/kafka/benchmarking-apache-kafka-2-million-writes-second-three-cheap-machines) — Jay Kreps, LinkedIn Engineering, 2014. Engineering blog. Checked 2026-11.
[^6]: 📝 [Exactly-Once Semantics Are Possible: Here's How Kafka Does It](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) — Neha Narkhede et al., Confluent, 2017. Engineering blog. Checked 2026-11.
[^7]: 📄 [Amazon SQS queue types](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html) — Amazon SQS Developer Guide. Official docs. Checked 2026-11.
[^8]: 📄 [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) — Amazon SQS Developer Guide. Official docs. Checked 2026-11.
[^9]: 📝 [How We're Improving and Advancing Kafka at LinkedIn](https://engineering.linkedin.com/apache-kafka/how-we_re-improving-and-advancing-kafka-linkedin) — Kartik Paramasivam, LinkedIn Engineering, 2015. Engineering blog. Checked 2026-11.
[^10]: 📝 [Kafka](https://engineering.linkedin.com/teams/data/data-infrastructure/streams/kafka) — LinkedIn Engineering, Data Infrastructure team page. Engineering blog. Checked 2026-11.
[^11]: 📝 [Apache Kafka 4.2.0 Release Announcement](https://www.confluent.io/blog/apache-kafka-4-2-release/) — Christo Lolov, Confluent Blog, February 2026. Engineering blog. Checked 2026-11.
