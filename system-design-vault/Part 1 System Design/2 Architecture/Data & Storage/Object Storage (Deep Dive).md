---
aliases: [Object Storage deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/data-and-storage]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Data & Storage]]"
basics: "[[Object Storage]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Data & Storage]] › [[Object Storage]] › 🔬 Deep Dive

> [!tldr] For engineers
> Object storage is a **flat namespace of keys mapping to immutable blobs**, served over HTTP. S3 gives strong read-after-write consistency per key, eleven nines of designed durability through erasure coding across zones, and request throughput that scales per key prefix. The trade: no partial updates, no cross-key atomicity, last-writer-wins on concurrent puts, and first-byte latency of about 100–200 ms unless you pay for a low-latency class.

> [!basics]- New to this? Start with the basics
> [[Object Storage]] explains it with no jargon.

## How it really works

### The data model

An object is data plus metadata (system name-value pairs such as `Content-Type` and last-modified, plus custom ones). It is uniquely identified by **bucket + key + optional version ID**, so S3 is "a basic data map between bucket + key + version and the object itself".[^1] There are no directories: a prefix is just the start of a key (keys go up to 1,024 bytes), and `LIST` with a `Delimiter` rolls matching keys up into `CommonPrefixes` so you can browse one level at a time.[^2]

```bash
# List the "folders" directly under photos/
aws s3api list-objects-v2 --bucket my-bucket --prefix photos/ --delimiter /
```

### Consistency

S3 provides **strong read-after-write consistency** for `PUT` and `DELETE` in all Regions: a `GET` or `LIST` that starts after a successful write sees it.[^1] Updates to a single key are atomic, so a concurrent reader gets the old or the new object, never a torn one.[^1] Two limits matter in design:[^1]

- **No locking.** Two simultaneous `PUT`s to one key resolve by last-writer-wins on timestamp.
- **No cross-key atomicity.** You can't make one key's update depend on another's.

Conditional writes let a `PUT` or multipart completion fail if the key already exists, which prevents silent overwrites.[^3] Bucket *configuration* is still eventually consistent: AWS suggests waiting 15 minutes after first enabling versioning before writing.[^1]

### Durability and placement

Every current S3 storage class (all but the deprecated Reduced Redundancy) is designed for 99.999999999% durability; all except the One Zone classes store data in at least three Availability Zones and survive the loss of one.[^4] Under the hood, S3 uses **erasure coding**: an object is split into *k* data shards plus *m* parity shards, and any *k* of them can rebuild it, tolerating failures with less overhead than full copies.[^5] Data is spread across "millions" of hard drives. Because a drive still does only about 120 random operations per second, S3 spreads each customer's objects across very many drives so bursts don't create hot spots, a practice its engineers call heat management.[^5]

### Performance

Throughput scales by prefix: at least **3,500 `PUT`/`COPY`/`POST`/`DELETE` and 5,500 `GET`/`HEAD` requests per second per partitioned prefix**, with no limit on prefixes.[^6] Ten prefixes can therefore serve about 55,000 reads per second. Scaling is gradual, and `503 Slow Down` errors may appear while it happens.[^6] Small-object latency is roughly 100–200 ms; a single EC2 instance can pull up to 100 Gb/s, and data-lake jobs aggregate many instances to terabits per second.[^6] For single-digit-millisecond access, S3 Express One Zone stores data in one zone you choose.[^4]

### Large objects

Multipart upload sends an object as independently retried parts, in parallel and in any order; AWS recommends it from 100 MB.[^3] Parts are 5 MiB to 5 GiB, up to 10,000 per upload, for a maximum object of 48.8 TiB.[^7] (AWS's 20th-anniversary post rounds this to 50 TB, up from 5 GB at launch.[^8]) Uncompleted uploads are billed until aborted, so add a lifecycle rule with `AbortIncompleteMultipartUpload`.[^3]

### Access control and presigned URLs

Buckets and objects are private by default, Block Public Access is on by default, and access is granted with IAM policies, bucket policies or access points; ACLs are disabled by default.[^1] A **presigned URL** grants time-limited `GET` or `PUT` on one key using the signer's permissions, valid up to 7 days with an IAM user's long-term keys and never longer than the credentials behind it.[^9] They are bearer tokens: whoever holds the link can use it.[^9]

```python
import boto3
s3 = boto3.client("s3")
url = s3.generate_presigned_url(
    "put_object",
    Params={"Bucket": "uploads", "Key": f"users/{user_id}/avatar.jpg"},
    ExpiresIn=600,  # 10 minutes
)
# Return url to the browser, which uploads straight to S3.
```

### Storage classes and lifecycle

| Class | Availability (designed) | Minimum duration | Access |
| --- | --- | --- | --- |
| Standard | 99.99% | None | Milliseconds |
| Standard-IA | 99.9% | 30 days, 128 KB minimum billed | Milliseconds, retrieval fee |
| One Zone-IA | 99.5% | 30 days | Milliseconds; lost if the zone is lost |
| Glacier Instant Retrieval | 99.9% | 90 days | Milliseconds |
| Glacier Flexible Retrieval | 99.99% after restore | 90 days | Minutes to hours, restore first |
| Glacier Deep Archive | 99.99% after restore | 180 days | Hours, restore first |

All figures from the S3 storage class comparison.[^4] Lifecycle rules transition objects between classes or expire them automatically.[^1]

### Beyond files

A **data lake** stores structured and unstructured data as-is, applying structure only when it is read, unlike a warehouse whose schema is fixed up front.[^10] Object storage is its usual home. S3 now also offers Apache Iceberg tables and native vector indexes of up to 2 billion vectors each.[^8] Azure's equivalent, Blob Storage, adds a hierarchical namespace for Data Lake Storage.[^11]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Object vs block/file storage | Unlimited scale, HTTP access, low cost | No in-place edits or locking; not for transactional data[^12] |
| Presigned direct upload vs proxy through app | App servers never touch the bytes | Link is a bearer token; validate after upload |
| Standard vs infrequent-access tiers | Lower storage price | Retrieval fees, minimum duration and size charges |
| Multi-zone vs One Zone | Survives a zone loss | Higher price |
| Versioning on | Recover from deletes and overwrites | Pay for every old version |
| Many prefixes | Parallel request capacity | Key naming must be planned |
| Metadata in a database, bytes in object storage | Rich queries over small records | Two systems to keep in step |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Designed durability, all current S3 classes | 99.999999999%[^4] |
| Request rate per prefix | 3,500 writes/s, 5,500 reads/s[^6] |
| Typical small-object latency | ~100–200 ms[^6] |
| Max object; max parts | 48.8 TiB; 10,000 parts of 5 MiB–5 GiB[^7] |
| Presigned URL max lifetime (IAM user, SigV4) | 7 days[^9] |
| S3 at launch (March 14, 2006) | ~1 PB on ~400 nodes, $0.15/GB[^8] |
| S3 in 2026 | 500+ trillion objects, 200M+ requests/s, hundreds of exabytes, ~$0.02/GB[^8] |
| Random I/O of one hard drive | ~120 operations/s, flat since 2006[^5] |
| Dropbox Magic Pocket block size; cell size | Up to 4 MB; ~50 PB raw per cell[^13] |

## Failure modes

- **Accidental public exposure.** Turning off Block Public Access or writing a broad bucket policy publishes data. Keep the defaults and grant narrowly.[^1]
- **Overwrites and deletes.** Last-writer-wins drops concurrent updates.[^1] Use versioning, conditional writes and Object Lock for write-once data.[^1][^3]
- **`503 Slow Down`.** A sudden spike on one prefix outruns gradual scaling. Spread keys across prefixes and retry with backoff.[^6]
- **Cost traps.** Tiny objects in IA classes are billed as 128 KB; early deletes pay the minimum duration; abandoned multipart parts bill forever.[^4][^3]
- **Leaked presigned URLs.** Keep expiry short and restrict signature age in the bucket policy.[^9]
- **Treating it as a database.** Read-modify-write races, no transactions across keys.[^1] Keep mutable state in a database and store immutable blobs.

## In the real world

- **Amazon S3** has kept full API backward compatibility for 20 years while progressively rewriting performance-critical request-path code in Rust.[^8] Its ShardStore storage layer is checked against a small executable specification with property-based tests on every commit.[^5]
- **Dropbox Magic Pocket** is an in-house, multi-exabyte, **immutable** block store. It keeps encrypted, compressed file chunks of up to 4 MB, addressed by SHA-256 hash, with the index in sharded MySQL. Each block lands in at least two US zones, aiming for a remote copy within a second, and older data is erasure coded.[^13]
- **Azure Blob Storage** offers block blobs up to about 190.7 TiB, append blobs for logs and page blobs for VM disks.[^11]

## In a design interview

For any "upload photos/videos" system, separate **bytes** from **metadata**:

1. **Upload:** "Client asks the API for a presigned `PUT`; uploads directly to the bucket; multipart above 100 MB."
2. **Metadata:** "A row in Postgres with owner, key, size, checksum and status."
3. **Serve:** "A [[CDN (Deep Dive)|CDN]] in front of the bucket; immutable keys like `users/42/ab12.jpg` so caches never go stale."
4. **Cost:** "Lifecycle to Standard-IA after 30 days, Glacier for originals after a year."

Interviewers probe: *How do you stop abuse of the upload link?* (Short expiry, size and type checks after upload.) *Hot objects?* (CDN.) *Consistency between DB row and object?* (Write object first, then commit the row; sweep orphans.)

## Check yourself

> [!question]- Two services PUT the same key at the same moment. What does a later GET return?
> One of the two objects, chosen by last-writer-wins on S3's internal timestamp. Never a mix. Which one wins can't be predicted, so use conditional writes or versioning if it matters.

> [!question]- Your service makes 20,000 GETs per second on keys that all start with `img/`. What do you expect?
> One prefix supports at least 5,500 reads per second, so expect `503 Slow Down` while S3 scales. Spread keys across more prefixes, add a CDN, and retry with backoff.

> [!question]- Why does erasure coding beat triple replication on cost?
> Replication stores three full copies (200% overhead). With k data plus m parity shards, overhead is m/k, and any k shards still rebuild the object, so durability holds with far less raw disk.

## Further reading

- 📝 [Building and operating a pretty big storage system called S3](https://www.allthingsdistributed.com/2023/07/building-and-operating-a-pretty-big-storage-system.html) — Andy Warfield on heat, erasure coding and formal methods inside S3.
- 📝 [Twenty years of Amazon S3](https://aws.amazon.com/blogs/aws/twenty-years-of-amazon-s3-and-building-whats-next/) — the scale, price and object-size history in one page.
- 📝 [Inside the Magic Pocket](https://dropbox.tech/infrastructure/inside-the-magic-pocket) — how Dropbox designed an exabyte-scale blob store of its own.
- 📄 [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) — the authoritative consistency model with concurrent-writer examples.
- 📄 [Optimizing Amazon S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) — prefix scaling, parallelism and latency figures.

## Related

- [[CDN (Deep Dive)]] — caching objects at the edge.
- [[SQL Databases (Deep Dive)]] — where object metadata usually lives.
- [[Replication (Deep Dive)]] — copies versus erasure coding.
- [[Authorization (Deep Dive)]] — policies behind bucket access and presigned links.
- [[Data Engineering & Pipelines (Deep Dive)]] — data lakes and table formats on object storage.
- [[Embeddings & Vector Databases (Deep Dive)]] — vector indexes now stored in object storage.

> [!nav] Keep going
> ← [[NoSQL Databases (Deep Dive)|NoSQL Databases]] · [[Data & Storage|🗄️ Data & Storage]] · [[CAP Theorem (Deep Dive)|CAP Theorem]] →
> 🌱 Back to the basics: [[Object Storage]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^2]: 📄 [Organizing objects using prefixes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^3]: 📄 [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^4]: 📄 [Understanding and managing Amazon S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^5]: 📝 [Building and operating a pretty big storage system called S3](https://www.allthingsdistributed.com/2023/07/building-and-operating-a-pretty-big-storage-system.html) — Andy Warfield, All Things Distributed, 2023. Engineering blog. Checked 2026-11.
[^6]: 📄 [Best practices design patterns: optimizing Amazon S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^7]: 📄 [Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^8]: 📝 [Twenty years of Amazon S3 and building what's next](https://aws.amazon.com/blogs/aws/twenty-years-of-amazon-s3-and-building-whats-next/) — AWS News Blog, 2026. Engineering blog. Checked 2026-11.
[^9]: 📄 [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^10]: 📄 [What is a data lake?](https://aws.amazon.com/what-is/data-lake/) — Amazon Web Services. Official docs. Checked 2026-11.
[^11]: 📄 [Introduction to Blob (object) Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction) — Microsoft Learn. Official docs. Checked 2026-11.
[^12]: 📖 [Object storage](https://en.wikipedia.org/wiki/Object_storage) — Wikipedia. Encyclopedia. Checked 2026-11.
[^13]: 📝 [Inside the Magic Pocket](https://dropbox.tech/infrastructure/inside-the-magic-pocket) — James Cowling, Dropbox Tech Blog, 2016. Engineering blog. Checked 2026-11.
