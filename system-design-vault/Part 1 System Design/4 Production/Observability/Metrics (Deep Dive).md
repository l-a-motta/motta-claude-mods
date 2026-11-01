---
aliases: [Metrics deep dive]
tags: [level/deep-dive, part/1, section/production, branch/observability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Observability]]"
basics: "[[Metrics]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Observability]] › [[Metrics]] › 🔬 Deep Dive

> [!tldr] For engineers
> Metrics are **pre-aggregated numeric time series** keyed by a name and a set of labels: cheap to store and query, ideal for dashboards and alerting, but blind to individual requests. The core skills are choosing the right type (counter, gauge, histogram), keeping **label cardinality** bounded, reading latency as **percentiles from histograms**, and alerting on **symptoms against an SLO** rather than on every cause.

> [!basics]- New to this? Start with the basics
> [[Metrics]] explains it with no jargon.

## How it really works

### Data model

Prometheus, an open-source monitoring toolkit, stores every metric as a **time series**: a stream of timestamped values identified by a metric name plus optional key-value **labels**.[^1] Every unique combination of label values is a separate series, so series count is the product of each label's distinct values.[^2] That product is the **cardinality** of a metric, and it drives memory, storage and query cost.

### Metric types

| Type | Semantics | Use for |
| --- | --- | --- |
| Counter | Monotonically increasing; resets to zero on restart[^3] | Requests served, errors, bytes sent |
| Gauge | Single value that goes up and down[^3] | Memory in use, queue depth, temperature |
| Histogram | Observations counted into configurable buckets, plus sum and count[^3] | Request latency, response size |
| Summary | Count and sum plus quantiles computed over a sliding window[^3] | Per-instance latency when no cross-instance aggregation is needed |

A classic histogram named `http_request_duration_seconds` exposes cumulative `_bucket{le="…"}` counters (each counts observations less than or equal to its bound), a `_sum` and a `_count` equal to the `+Inf` bucket.[^3] Quantiles are computed at query time with `histogram_quantile()`.[^3] Classic histograms with different bucket boundaries do not aggregate; native histograms use a bucketing schema that always aggregates.[^3]

The first query is the error ratio over five minutes (RED's errors over rate); the second is fleet-wide p99 latency (RED's duration):

```promql
sum(rate(http_requests_total{code=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

Naming conventions keep this sane: base units (seconds, bytes), a plural unit suffix, and `_total` on counters, as in `process_cpu_seconds_total`.[^2]

### Collection: pull by default

Prometheus **scrapes** targets over HTTP, discovering them through service discovery or static config; short-lived jobs push to a Pushgateway instead.[^1] Each server is standalone and does not depend on remote storage, so monitoring stays up while the rest of the infrastructure is broken.[^1] A separate Alertmanager handles the alerts that rules produce.[^1]

### What to measure

- **Four golden signals** (Google SRE): latency, traffic, errors, saturation.[^4] Track latency of failed requests separately, because a slow error is worse than a fast one.[^4] Saturation needs a target below 100%, since many systems degrade before they are full.[^4]
- **RED** (Tom Wilkie, 2015) for every service: rate, errors, duration.[^5] Wilkie describes the golden signals as RED plus saturation, and argues uniform RED dashboards let people go on call for code they did not write.[^5]
- **USE** (Brendan Gregg) for every resource: utilization, saturation, errors.[^6] It covers CPUs, memory, disks, network interfaces and controllers, and software resources such as thread pools and file descriptors.[^6]

RED is the user's view; USE is the machine's view; they are two lenses on the same system.[^5]

### Alerting on SLOs

Paging on causes ("CPU at 90%") produces noise. Google's guidance is to page on symptoms, make every page actionable, and avoid pages that merit only a robotic response.[^4] The SRE Workbook turns that into **burn-rate alerts**. The **error budget** is the number of bad events an SLO allows, and **burn rate** is how fast you consume it relative to the SLO: a rate of 1 spends the budget exactly at the window's end.[^7] It recommends **multiwindow, multi-burn-rate** alerts, where a short window (1/12 of the long one) confirms the problem is still happening so alerts reset quickly.[^7]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Pull (scrape) | Server controls load; "target down" is itself a signal | Needs discovery; awkward for short-lived jobs |
| Push (gateway, agents) | Works for batch jobs and behind firewalls | Harder to tell "no data" from "dead" |
| Histogram | Aggregatable across instances; quantile chosen at query time | Bucket layout fixes accuracy; one series per bucket |
| Summary | Accurate quantiles per instance | Quantiles fixed in advance; not aggregatable across instances |
| Rich labels | Slice by any dimension | Cardinality explosion |
| Static thresholds | Simple to write | Noisy; blind to slow burns |
| SLO burn-rate alerts | High precision and recall tied to user impact | Needs a defined SLI and SLO first |
| Single Prometheus per team | Simple, survives outages | No global view; limited retention |
| Global remote storage (M3, etc.) | Fleet-wide queries, long retention | Another distributed system to operate |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| How averages lie | At 1,000 req/s and a 100 ms mean, 1% of requests could take 5 s[^4] |
| Suggested latency bucket spacing | Roughly 3x apart: 0–10, 10–30, 30–100, 100–300 ms[^4] |
| Burn rate that drains a 30-day budget in 43 minutes | 1,000[^7] |
| Page thresholds for a 99.9% SLO | 2% of budget in 1 h (burn 14.4); 5% in 6 h (burn 6)[^7] |
| Ticket threshold | 10% of budget in 3 days (burn 1)[^7] |
| Uber M3 scale (2018) | 500M metrics/s aggregated, 20M/s persisted, 6.6B time series[^8] |
| USE method payoff, per its author | About 80% of server issues for 5% of the effort[^6] |
| Prometheus history | Started at SoundCloud in 2012; CNCF's second hosted project in 2016[^1] |

## Failure modes

- **Cardinality explosion.** Someone adds a `user_id` or email label and series count grows without bound. Prometheus's docs explicitly warn against labels with unbounded values.[^2] Defend with label allow-lists, per-target series limits and review of new metrics; push per-user detail to logs or traces.
- **Alert fatigue.** Google's Bigtable team alerted on a tail they could not fix and drowned in non-actionable pages; they temporarily relaxed the SLO to the 75th percentile and disabled email alerts to buy time for real fixes.[^4] Gmail's pages for routine task rescheduling were a sign of technical debt to automate away.[^4]
- **Averaging quantiles.** Averaging per-instance p99s is mathematically meaningless. Aggregate histogram buckets, then compute the quantile.[^3]
- **Counter resets.** Counters drop to zero on restart.[^3] Use functions such as `rate()` that handle resets instead of subtracting raw values.
- **Wrong tool for the job.** Prometheus trades accuracy for reliability and is not suitable for per-request billing.[^1]
- **Fragile storage at scale.** Uber's earlier Graphite setup needed manual resharding and lost a node's metrics permanently on disk failure, which drove the move to replicated M3.[^8]
- **Monitoring that dies with the system.** If alerting shares fate with production, the outage silences its own alarm. Keep monitoring standalone and add an external black-box probe.[^1][^4]

## In the real world

- **SoundCloud** created Prometheus; it is now independent and CNCF-hosted, with exporters for third-party systems and PromQL for queries.[^1]
- **Uber** built M3 and M3DB as a remote storage backend so many Prometheus deployments could share one global query view, using quorum writes to three replicas in a region.[^8]
- **Google SRE** codified the golden signals and symptom-based paging,[^4] and the SRE Workbook gives concrete burn-rate thresholds for alert rules.[^7]
- **Grafana Labs** published Wilkie's RED method for microservices, suggesting saturation be measured as CPU use against quota on Kubernetes.[^5]

## In a design interview

When asked "how would you monitor this?":

1. **SLIs first:** "Availability = non-5xx / total; latency = p99 of successful requests under 300 ms."
2. **Instrument RED per service, USE per resource:** "Counters for requests and errors, a histogram for duration, gauges for queue depth and pool usage."
3. **Collect:** "Prometheus scraping each pod, federated or remote-written to long-term storage."
4. **Alert:** "Multiwindow burn-rate alerts on the SLO page someone; cause metrics live on dashboards for diagnosis."

Interviewers probe: *Why p99 and not the average?* (Tails hide behind means.) *Can you add customer ID as a label?* (No: cardinality; use logs or traces.) *How do you avoid alert fatigue?* (Symptom-based, actionable, SLO-driven.) *What monitors the monitor?* (External probes, independent alert path.)

## Check yourself

> [!question]- Why must you aggregate histogram buckets before computing p99 across 50 instances?
> Quantiles do not compose. The mean of 50 p99s is not the fleet p99. Summing bucket counts first gives the true combined distribution, then `histogram_quantile` estimates the percentile.

> [!question]- A metric has labels method (5 values), route (40), status (8) and pod (100). How many series?
> Up to 5 × 40 × 8 × 100 = 160,000 series for one metric name, before histogram buckets multiply it further.

> [!question]- Why pair a 1-hour window with a 5-minute window in a burn-rate alert?
> The long window gives enough evidence to avoid paging on blips; the short window confirms the burn is still happening, so the alert resets soon after the problem stops.

## Further reading

- 📘 [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — the chapter that defined the four golden signals and symptom-based paging.
- 📘 [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — step-by-step from naive alerts to multiwindow burn-rate rules.
- 📄 [Metric types](https://prometheus.io/docs/concepts/metric_types/) — counters, gauges, histograms and summaries, precisely.
- 📝 [The USE Method](https://www.brendangregg.com/usemethod.html) — a checklist that finds most resource bottlenecks fast.
- 📝 [The RED Method](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/) — the service-level counterpart to USE.

## Related

- [[Logging (Deep Dive)]] — high-detail events for diagnosis once a metric fires.
- [[Distributed Tracing (Deep Dive)]] — per-request latency breakdowns that metrics cannot give.
- [[Fault Tolerance (Deep Dive)]] — SLOs and error budgets frame reliability work.
- [[Load Balancing (Deep Dive)]] — health checks and saturation signals steer traffic.
- [[Estimation (Deep Dive)]] — capacity math starts from measured traffic and utilization.
- [[AI Monitoring & Observability (Deep Dive)]] — model quality, drift and token metrics on top of RED.

> [!nav] Keep going
> ← [[Logging (Deep Dive)|Logging]] · [[Observability|🔭 Observability]] · [[Distributed Tracing (Deep Dive)|Distributed Tracing]] →
> 🌱 Back to the basics: [[Metrics]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Overview](https://prometheus.io/docs/introduction/overview/) — Prometheus documentation. Official docs. Checked 2026-11.
[^2]: 📄 [Metric and label naming](https://prometheus.io/docs/practices/naming/) — Prometheus documentation. Official docs. Checked 2026-11.
[^3]: 📄 [Metric types](https://prometheus.io/docs/concepts/metric_types/) — Prometheus documentation. Official docs. Checked 2026-11.
[^4]: 📘 [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — Site Reliability Engineering, Google (O'Reilly). Book. Checked 2026-11.
[^5]: 📝 [The RED Method: How to instrument your services](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/) — Grafana Labs, 2018. Article. Checked 2026-11.
[^6]: 📝 [The USE Method](https://www.brendangregg.com/usemethod.html) — Brendan Gregg. Article. Checked 2026-11.
[^7]: 📘 [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — The Site Reliability Workbook, Google (O'Reilly). Book. Checked 2026-11.
[^8]: 📝 [M3: Uber's Open Source, Large-scale Metrics Platform for Prometheus](https://www.uber.com/us/en/blog/m3/) — Uber Engineering, 2018. Engineering blog. Checked 2026-11.
