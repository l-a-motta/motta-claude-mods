---
aliases: [Feature Engineering deep dive]
tags: [level/deep-dive, part/2, section/the-12-ribs]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[The 12 Ribs]]"
basics: "[[Feature Engineering]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[The 12 Ribs]] › [[Feature Engineering]] › 🔬 Deep Dive

> [!tldr] For engineers
> Feature engineering has two halves: **representation** (scaling, encoding, bucketing, crossing raw signals into model-friendly inputs) and **plumbing** (computing the same feature identically, at the right point in time, for training and serving). The representation half is mostly settled craft; the plumbing half is where production systems fail, through training-serving skew, label leakage and stale values. Feature stores exist to make one definition produce both a point-in-time-correct offline history and a low-latency online value.

> [!basics]- New to this? Start with the basics
> [[Feature Engineering]] explains it with no jargon.

## How it really works

### Representation: numeric features

Normalization puts features on similar scales so training converges faster, large values don't overflow into NaN, and wide-range features don't dominate the weights.[^1] Pick by distribution:[^1]

- **Linear (min-max) scaling** for roughly uniform data with few outliers.
- **Z-score** for roughly normal data.
- **Log scaling** for power-law data such as sales or ratings counts.
- **Clipping** to cap outliers, often combined with the others, for example clipping z-scores beyond ±3.

The non-negotiable rule: whatever transformation you fit in training must be applied identically at prediction time.[^1]

### Representation: categorical features

One-hot encoding gives each category its own dimension, stored sparsely as just the index of the 1.[^2] Rare values go to a shared **out-of-vocabulary bucket** with one learned weight.[^2] When cardinality is high, one-hot becomes a poor choice: **embeddings** compress categories into dense low-dimensional vectors, and **hashing** maps categories into a fixed number of buckets at the cost of collisions.[^2]

**Feature crosses** multiply categorical or bucketed features so a linear model can capture interactions; the catch is sparsity, since crossing a 100-value feature with a 200-value one yields 20,000 dimensions.[^3] Neural networks can learn such combinations themselves, but at significant compute cost.[^3]

### Leakage and point-in-time correctness

Data leakage is using "information that would not be available at prediction time" to build the model, which inflates offline scores.[^4] The rules: split before any preprocessing, call `fit` only on training data, and wrap preprocessing and model in one pipeline so cross-validation can't cheat.[^4]

```python
pre = make_column_transformer(
    (StandardScaler(), ["trip_minutes", "fare"]),
    (OneHotEncoder(handle_unknown="ignore"), ["city"]),  # unseen city -> all zeros
)
model = make_pipeline(pre, LogisticRegression())
model.fit(X_train, y_train)  # scaler means and city vocabulary learned from train only
```

Time adds a second kind of leakage. A training row labeled at time *t* must see each feature as it was at *t*, not as it is today. Feast's **point-in-time join** scans backward from each row's timestamp, up to the feature view's TTL, and returns the latest value at or before that moment.[^5] By default only the event timestamp is constrained (the created timestamp merely breaks ties), so a value backfilled or corrected later can still leak; passing `filter_by_created_timestamp=True` restricts each row to values created at or before its own timestamp, provided the created-timestamp column is populated.[^5]

### Training-serving skew

Google's Rules of ML define training-serving skew as a gap between performance in training and in serving, caused by different pipeline code, data changing between training and serving, or feedback loops.[^6] The defenses are concrete:

- **Log serving features** and train on the logs; YouTube's home page did this and saw significant quality improvements and less code complexity.[^6]
- **Snapshot or log joined tables**, because a side table that changes between training and serving gives the same item different features.[^6]
- **Share code** between training and serving; two languages make sharing nearly impossible.[^6]
- **Measure it**: the same example scored in both paths should give exactly the same result.[^6]

Uber's Michelangelo built the "share code" defense into the platform: a Scala-based feature DSL whose expressions run identically at training and prediction time.[^7] TFDV adds monitoring: it flags **distribution skew** between training and serving data, and drift across days, using L-infinity distance for categorical features and approximate Jensen-Shannon divergence for numeric ones.[^8]

### Feature stores

A feature store couples an **offline store** for historical, point-in-time-correct training data with an **online store** for low-latency serving, behind one feature definition.[^9] Feast describes itself as a thin layer over existing infrastructure, explicitly not an ETL system, orchestrator, warehouse or database.[^9] Michelangelo's design is the template: batch jobs on HDFS precompute features like a 7-day average, Kafka and Samza streams compute 1-hour versions, both land in Cassandra for serving, and about 10,000 features carry metadata such as owner, description and SLA.[^7]

There are two ways to get training data for a new feature. **Log and wait**: start logging serving-time values and train once enough history accrues, which guarantees consistency but takes time.[^6][^10] **Backfill**: compute the feature's history from warehouse data with point-in-time-correct logic. Airbnb's Chronon is built around backfills that are consistent with online serving, over both batch and streaming sources.[^10]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Log-and-wait training data | Exact serving values; no skew by construction[^6] | A long wait before a new feature has training history[^10] |
| Point-in-time backfill | Train on a new feature today[^10] | Backfill logic must exactly match online logic |
| Batch features | Simple, cheap, easy to backfill | Values hours stale |
| Streaming features | Fresh signals such as last-hour counts[^7] | Stream jobs, state and late data to manage |
| One-hot | Exact, interpretable weights | Explodes with high cardinality[^2] |
| Hashing | Fixed memory, handles unseen values | Collisions blur categories[^2] |
| Embeddings | Dense, captures similarity | Must be learned; less interpretable[^2] |
| Shared feature store | Reuse, one definition, consistency[^9] | Platform to run; governance overhead |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Uber Michelangelo shared features | ~10,000, with owner, description and SLA[^7] |
| Michelangelo online p95 latency | <5 ms without Cassandra features, <10 ms with them[^7] |
| Michelangelo top-model throughput | 250,000+ predictions/s[^7] |
| Leakage demo: random features, random labels | Selecting features on all data scores 0.76 accuracy; correctly fit on train only, 0.5[^4] |
| Unscaled test data, scaled training data | Test MSE 62.80 vs. 0.90 when transformed consistently[^4] |
| Cross of 100- and 200-value features | 20,000 sparse dimensions[^3] |
| Typical clip for z-scores | ±3 standard deviations[^1] |
| Stale feature table at Google Play | 6 months stale; refreshing it alone gave +2% install rate[^6] |

The leakage demo is worth memorizing: with labels that are pure noise, leaking test data into feature selection still produced 76% accuracy, a model that looks good and knows nothing.[^4]

## Failure modes

- **Duplicated logic drifts.** Training in Python and serving in Java, two "identical" implementations diverge on edge cases such as nulls or time zones. Share code or a DSL, and log serving features.[^6][^7]
- **Changing side tables.** A joined table updates between training and serving and features silently differ; snapshot or log the joined values.[^6]
- **Label leakage.** A feature encodes the outcome, such as a refund flag for a fraud label, or uses future data. Use point-in-time joins and created-timestamp filters.[^5]
- **Stale features.** An upstream job stops and the online store serves old values without error. Alert on feature freshness, not just job success.[^6]
- **Unstable and underutilized inputs.** Legacy, bundled, ε-features (tiny gains) and correlated features make models brittle; run leave-one-feature-out checks and prune.[^11]
- **Unseen categories.** A new city appears at serving time; route it to an OOV bucket or ignore it explicitly instead of crashing.[^2]
- **Distribution drift.** Inputs shift over time; monitor drift with per-feature thresholds.[^8]

## In the real world

- **Uber Michelangelo**: shared feature store, Scala DSL for train/serve parity, batch plus near-real-time features, Cassandra online store.[^7]
- **Airbnb Chronon**: open-source feature platform with point-in-time-accurate backfills and online/offline consistency; Stripe is listed among adopters.[^10]
- **Feast**: open-source feature store over existing warehouses and key-value stores such as BigQuery, Snowflake, DynamoDB or Redis.[^9]
- **Google TFX**: TFDV computes statistics, validates against a schema and detects skew and drift.[^8]

## In a design interview

For a ranking or fraud model, walk through features in three tiers:

1. **Entity features** (batch): "Restaurant's 7-day average prep time, recomputed daily."
2. **Real-time features** (streaming): "Orders in the last 15 minutes, from Kafka into the online store."
3. **Request features**: "Time of day, device, computed in the request path."

Then cover the plumbing: "One definition feeds an offline store for point-in-time training sets and an online key-value store with p99 under 10 ms; we log served features and compare them to offline values daily to measure skew."

Interviewers probe: *How do you avoid leakage?* (Point-in-time joins; split by time.) *What if the online store is down?* (Defaults or a fallback model; never block the request.) *How fresh must features be?* (Tie freshness to the decision; most don't need streaming.) *High-cardinality IDs?* (Hashing or embeddings.)

## 🧱 Builds on

- [[Data Structures]] — sparse vectors store only non-zero indices, the hashing trick maps unbounded vocabularies into fixed buckets, and embeddings are lookup tables.
- [[Databases]] — the offline store is a columnar history queried with as-of joins; the online store is a key-value table keyed by entity ID.
- [[Caching]] — the online store is a materialized, precomputed cache with TTL-like freshness bounds; Feast's TTL also bounds point-in-time lookback.

## Check yourself

> [!question]- Why is "log serving features and train on the logs" the strongest skew defense, and what does it cost?
> The model trains on exactly the values it saw in production, so pipeline differences cannot creep in. The cost is time: a new feature has no history until it has been logged for long enough.

> [!question]- A point-in-time join still leaks future data after a backfill corrected some values. Why?
> The join constrained only the event timestamp, so a value written later but stamped earlier was returned. Also require the row's created timestamp to be at or before the label time.

> [!question]- When would you choose hashing over one-hot for a categorical feature?
> When cardinality is huge or unbounded, such as user or URL IDs, and you need fixed memory and graceful handling of unseen values, accepting some collisions.

## Further reading

- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Rules #16 to #37 are a compact course on features and skew.
- 📄 [Point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins) — a clear worked example of as-of joins with TTL.
- 📄 [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — leakage demonstrated in a few lines of code.
- 📝 [Meet Michelangelo](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — the write-up that shaped how the industry thinks about feature stores.
- 📄 [Chronon on GitHub](https://github.com/airbnb/chronon) — a modern open-source feature platform built around backfills.

## Related

- [[Data Engineering & Pipelines (Deep Dive)]] — the batch and streaming jobs that compute features.
- [[Embeddings & Vector Databases (Deep Dive)]] — learned dense features and how they are stored.
- [[Deployment & Serving (Deep Dive)]] — fetching online features inside the latency budget.
- [[AI Monitoring & Observability (Deep Dive)]] — skew and drift monitoring in production.
- [[Caching (Deep Dive)]] — freshness and TTL trade-offs that the online store inherits.

> [!nav] Keep going
> ← [[Model Selection & Training (Deep Dive)|Model Selection & Training]] · [[The 12 Ribs|☂️ The 12 Ribs]] · [[Evaluation & Metrics (Deep Dive)|Evaluation & Metrics]] →
> 🌱 Back to the basics: [[Feature Engineering]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🎓 [Numerical data: Normalization](https://developers.google.com/machine-learning/crash-course/numerical-data/normalization) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^2]: 🎓 [Categorical data: One-hot encoding](https://developers.google.com/machine-learning/crash-course/categorical-data/one-hot-encoding) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^3]: 🎓 [Categorical data: Feature crosses](https://developers.google.com/machine-learning/crash-course/categorical-data/feature-crosses) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^4]: 📄 [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn documentation. Official docs. Checked 2026-11.
[^5]: 📄 [Point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins) — Feast documentation. Official docs. Checked 2026-11.
[^6]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, Rules #10, #29, #31, #32 and #37. Official docs. Checked 2026-11.
[^7]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^8]: 📄 [TensorFlow Data Validation](https://www.tensorflow.org/tfx/guide/tfdv) — TensorFlow TFX guide. Official docs. Checked 2026-11.
[^9]: 📄 [Introduction](https://docs.feast.dev/) — Feast documentation. Official docs. Checked 2026-11.
[^10]: 📄 [Chronon](https://github.com/airbnb/chronon) — Airbnb, GitHub repository README. Official docs. Checked 2026-11.
[^11]: 🔬 [Hidden Technical Debt in Machine Learning Systems](https://proceedings.neurips.cc/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) — Sculley et al., Google, NeurIPS 2015, section 3. Paper. Checked 2026-11.
