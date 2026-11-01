---
aliases: [CDN deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/performance]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Performance]]"
basics: "[[CDN]]"
reading_time: 10 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Performance]] › [[CDN]] › 🔬 Deep Dive

> [!tldr] For engineers
> A CDN is a **geographically distributed, multi-tier HTTP cache plus a request-routing system**. Routing (DNS mapping or anycast) steers each client to a low-latency PoP; the PoP answers from cache or fetches through mid-tier caches to the origin. The levers you control are cacheability headers, the cache key, tiering and how you invalidate. The classic failures are caching personalized responses, fragmented cache keys, and the CDN itself as a shared point of failure.

> [!basics]- New to this? Start with the basics
> [[CDN]] explains it with no jargon.

## How it really works

Every CDN answers four questions: **which PoP serves this client**, **may this response be cached**, **what makes two requests "the same"**, and **where does a miss go next**.

### Request routing

**DNS-based mapping.** The client resolves the site's hostname and the CDN's DNS returns the address of a PoP, "typically the nearest CloudFront POP in terms of latency".[^1] Akamai's mapping system does the same, choosing an edge server from large amounts of historical and live data about network and server conditions.[^2]

**Anycast.** Many data centers announce the same IP address, and ordinary internet routing delivers each request to a nearby one.[^3] If a whole site goes offline its announcements disappear and traffic flows to the next closest; attack traffic from a botnet is likewise split across sites.[^3]

**Application-level steering.** Netflix skips both: appliances report health, learned BGP routes and stored files to a control plane in AWS, which hands each client explicit URLs for the best appliances.[^4]

### The edge cache

On a hit the PoP answers directly. On a miss CloudFront forwards the request to the origin, starts streaming to the viewer as soon as the first byte arrives, and stores the object for the next request.[^1]

Whether a response may be stored is governed by HTTP caching. RFC 9111 defines a **shared cache** as one that "stores responses for reuse by more than one user"; a CDN is one, and `s-maxage` overrides `max-age` for shared caches only.[^5] `private` keeps a response out of shared caches, and a cookie alone does not make a response private.[^6] CDNs add their own defaults on top. Cloudflare caches by file extension, not HTML or JSON by default, and skips responses with `Set-Cookie`, `private`, `no-store`, `no-cache` or `max-age=0`.[^7]

```http
# Versioned static asset: cache everywhere for a year
Cache-Control: public, max-age=31536000, immutable
# Shared HTML: browser 60 s, CDN 10 min, serve stale briefly while refetching
Cache-Control: max-age=60, s-maxage=600, stale-while-revalidate=30, stale-if-error=86400
# Personalized page: never in a shared cache
Cache-Control: private, no-cache
```

### The cache key

The **cache key** decides whether two requests are the same object. RFC 9111 requires at least the method and target URI.[^5] CloudFront's default key is just the distribution's domain and the URL path; query strings, headers and cookies are excluded unless a cache policy adds them.[^8]

Every value you add multiplies the variants. `Accept-Language` arrives as `en-US,en`, `en,en-US` or `en-US`, which caches the same English page several times; `User-Agent` has thousands of variants.[^8] The fix is to vary the URL instead (`/en-US/...`), and to forward values the origin needs for analytics through an origin request policy without putting them in the key.[^8] The HTTP equivalent is `Vary`, which keys the cache on the URL plus the named request headers.[^6]

### Tiered caching

Edge PoPs are small and evict unpopular objects. CloudFront places larger **regional edge caches** between PoPs and the origin, so all PoPs in a region share one cache and long-tail content stays close.[^1] Non-cacheable methods (`PUT`, `POST`, `PATCH`, `OPTIONS`, `DELETE`) and requests judged dynamic skip that tier and go straight to the origin.[^1]

**Origin Shield** adds one more tier in a single region. Concurrent misses for the same object are consolidated, "resulting in as few as one request going to your origin".[^9] Cloudflare's Tiered Cache works the same way: lower-tier data centers ask an upper tier, and only upper tiers may contact the origin; Smart Tiered Cache picks the upper tier from latency data.[^10] Akamai calls these "parent" clusters and reported origin offload in the high 90s percent even for very large content libraries.[^2]

### Freshness and invalidation

You can **invalidate** (purge) an object or **version** its file name. CloudFront recommends versioning for files that change often: an invalidation cannot reach copies already held by browsers or corporate proxies, versioning makes rollbacks trivial, and you don't pay for invalidations.[^11]

RFC 5861 adds two directives that make TTLs forgiving.[^12] `stale-while-revalidate=30` lets a cache serve a just-expired copy for 30 seconds while it refetches in the background. `stale-if-error` lets it serve a stale copy when the origin returns 500, 502, 503 or 504.[^12]

### Beyond static files

Modern CDNs also accelerate content that can't be cached. Akamai's platform routes origin traffic over an optimized overlay network and runs application logic at the edge.[^2] Netflix inverts the model: because it can predict what members will watch, it pushes content to its appliances in off-peak fill windows, and appliances fetch updates from each other.[^4]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| DNS-based routing | Per-client mapping from live network data | Failover waits on DNS TTLs; the resolver may not sit near the user |
| Anycast routing | Automatic nearest-site delivery and failover; spreads DDoS traffic | BGP, not you, decides which site serves whom |
| Long TTL + versioned URLs | Highest hit ratio; deploys are just new names | Needs a build step that fingerprints file names |
| Short TTL or purge on change | Simple, stable URLs | More origin traffic; purges miss browser and proxy caches |
| Rich cache key | Correct per-language or per-device variants | Fragmentation, lower hit ratio, more origin load |
| Tiered cache / origin shield | Fewer origin requests; request collapsing | Extra hop on misses; extra charges |
| Multi-CDN | Survives one provider's outage | Duplicate origin traffic; configs drift apart |
| Build your own (Netflix) | Full control; proactive fill | Hardware, peering and operations at enormous scale |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Round-trip time, server under 100 miles vs ~6,000 miles away (2010) | 1.6 ms vs 96 ms[^2] |
| Throughput over the same distances | 44 Mbps vs 0.4 Mbps; a 4 GB download takes 12 min vs 20 h[^2] |
| Networks needed to reach 90% of internet access traffic (2010) | Well over 650[^2] |
| Akamai scale (2010) | 61,000+ servers in ~1,000 networks and 70 countries; 15–20% of web traffic[^2] |
| Origin offload with tiered distribution | High 90s percent[^2] |
| Cloudflare edge TTL when the origin sends no Cache-Control | 200/206/301: 120 min; 302/303: 20 min; 404/410: 3 min[^7] |
| Netflix Open Connect partners | Over a thousand ISPs[^13] |
| Fastly outage, June 8, 2021 | 85% of the network returned errors; 95% normal within 49 min[^14] |

A quick sizing check: origin requests ≈ total requests × (1 − hit ratio). Moving from a 90% to a 99% hit ratio cuts origin load tenfold, which is why tiering and key hygiene matter more than adding PoPs.

## Failure modes

- **Caching personalized responses.** On December 25, 2015, during a DoS attack, Steam deployed a caching configuration that "incorrectly cached web traffic for authenticated users"; store pages for about 34,000 users may have been shown to others between 11:50 and 13:20 PST.[^15] Defend with `Cache-Control: private` on every personalized response and default-deny caching rules for authenticated paths.[^6]
- **Fragmented cache keys.** Tracking parameters, cookies or `User-Agent` in the key create near-duplicate objects and collapse the hit ratio.[^8] Audit the key; whitelist only the values that change the response.
- **Stale content after a deploy.** Purging the CDN doesn't touch browser or proxy caches.[^11] Ship fingerprinted file names and keep HTML on short TTLs.
- **Origin stampede.** A new release or a purge makes every PoP miss at once. Tiered caches and Origin Shield collapse those misses into a handful of origin requests.[^9]
- **Origin outage.** Without help, every miss becomes an error. `stale-if-error` keeps serving the last good copy for a bounded time.[^12]
- **The CDN as a shared failure point.** On June 8, 2021, a valid customer configuration change triggered a latent bug in Fastly's software and 85% of its network returned errors; Fastly detected it within a minute and had 95% of the network back within 49 minutes.[^14] Critical sites hedge with multi-CDN and DNS failover.

## In the real world

- **Akamai** pioneered the CDN and reached deep into end-user ISPs instead of a few giant data centers, arguing that only a highly distributed platform can deliver video at scale.[^2]
- **Amazon CloudFront** layers PoPs, regional edge caches and optional Origin Shield in front of S3 buckets or HTTP origins.[^1][^9]
- **Cloudflare** runs an anycast network where every data center announces the same addresses, with Tiered Cache to protect origins.[^3][^10]
- **Netflix Open Connect** places purpose-built appliances in internet exchanges and, free of charge, inside qualifying ISPs; its directed, proactive caching cut upstream demand "by several orders of magnitude" versus demand-driven caching.[^4]

## In a design interview

Start by splitting traffic by cacheability, then walk the request path.

1. **Classify:** "Images, video and JS bundles are static and versioned: one-year TTL. Shared HTML gets a short `s-maxage` with `stale-while-revalidate`. API calls and account pages are `private` and bypass the edge."
2. **Route:** "A managed CDN with anycast or DNS mapping; the origin is object storage."
3. **Protect the origin:** "Origin Shield or tiered cache; origin load is requests × (1 − hit ratio)."
4. **Invalidate:** "Fingerprinted file names for deploys; purge only for emergencies."
5. **Fail:** "`stale-if-error` for origin outages; a second CDN behind DNS failover if the business requires it."

Interviewers probe: *How do you serve per-user content?* (Don't cache it at the edge; cache the shared shell.) *How do you ship a new JS bundle?* (New hashed name, HTML points to it.) *What if the CDN goes down?* (Fastly 2021; multi-CDN.) *Live video spike?* (Tiering and request collapsing so one origin fetch feeds millions.)

## Check yourself

> [!question]- A campaign adds ?utm_source=… to every link and your hit ratio drops from 95% to 60%. Why, and what's the fix?
> Query strings are in the cache key, so each tracking value creates a separate cached object and a separate origin miss. Remove tracking parameters from the key and, if the origin needs them, forward them in origin requests only.

> [!question]- Why does CloudFront recommend versioned file names over invalidations for frequently updated files?
> Invalidations only clear the CDN, not browser or corporate proxy caches; versioning controls exactly which file every client fetches, makes rollback trivial and avoids invalidation charges.

> [!question]- Forty PoPs miss on a newly released video at the same moment. How many requests reach the origin with and without an origin shield?
> Without a shield, up to forty (or one per regional edge cache, if those exist). With a shield, concurrent misses are consolidated in one region, so as few as one request reaches the origin.

## Further reading

- 🔬 [The Akamai Network](https://courses.cs.duke.edu/fall21/compsci514/internal/readings/NygrenSS10.pdf) — why the internet's "middle mile" is slow and how a CDN is built to route around it.
- 📄 [How CloudFront delivers content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html) — a short, concrete walk through PoPs and regional edge caches.
- 📄 [Understand the cache key](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-the-cache-key.html) — the clearest explanation of why every extra key component costs hit ratio.
- 📄 [Open Connect Overview](https://openconnect.netflix.com/Open-Connect-Overview.pdf) — how a company with predictable demand built a push-based CDN.
- 📄 [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — the standard every CDN's caching rules start from.
- 📝 [Summary of June 8 outage](https://www.fastly.com/blog/summary-of-june-8-outage) — a candid post-mortem of a global CDN failure.

## Related

- [[Caching (Deep Dive)]] — HTTP headers, eviction and stampedes in depth.
- [[Load Balancing (Deep Dive)]] — anycast, ECMP and consistent hashing inside each PoP.
- [[Networking (Deep Dive)]] — DNS, BGP and the TCP behavior that makes distance expensive.
- [[Object Storage (Deep Dive)]] — the usual origin behind a CDN.
- [[Fault Tolerance (Deep Dive)]] — planning for a provider-wide outage.
- [[Rate Limiting (Deep Dive)]] — the edge is where abusive traffic is filtered first.

> [!nav] Keep going
> ← [[Caching (Deep Dive)|Caching]] · [[Performance|⚡ Performance]] · [[Load Balancing (Deep Dive)|Load Balancing]] →
> 🌱 Back to the basics: [[CDN]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [How CloudFront delivers content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html) — Amazon CloudFront Developer Guide. Official docs. Checked 2026-11.
[^2]: 🔬 [The Akamai Network: A Platform for High-Performance Internet Applications](https://courses.cs.duke.edu/fall21/compsci514/internal/readings/NygrenSS10.pdf) — Nygren, Sitaraman and Sun, Akamai Technologies, 2010, sections 1–5. Paper. Checked 2026-11.
[^3]: 📝 [A Brief Anycast Primer](https://blog.cloudflare.com/a-brief-anycast-primer/) — Cloudflare Blog, 2011. Engineering blog. Checked 2026-11.
[^4]: 📄 [Open Connect Overview](https://openconnect.netflix.com/Open-Connect-Overview.pdf) — Netflix. Official docs. Checked 2026-11.
[^5]: 📄 [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — Fielding, Nottingham and Reschke, IETF, June 2022. Standard. Checked 2026-11.
[^6]: 📄 [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — MDN Web Docs. Official docs. Checked 2026-11.
[^7]: 📄 [Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) — Cloudflare Docs. Official docs. Checked 2026-11.
[^8]: 📄 [Understand the cache key](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-the-cache-key.html) — Amazon CloudFront Developer Guide. Official docs. Checked 2026-11.
[^9]: 📄 [Use Amazon CloudFront Origin Shield](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-shield.html) — Amazon CloudFront Developer Guide. Official docs. Checked 2026-11.
[^10]: 📄 [Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/) — Cloudflare Docs. Official docs. Checked 2026-11.
[^11]: 📄 [Invalidate files to remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html) — Amazon CloudFront Developer Guide. Official docs. Checked 2026-11.
[^12]: 📄 [RFC 5861: HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861.html) — IETF, May 2010. RFC. Checked 2026-11.
[^13]: 📄 [Open Connect](https://openconnect.netflix.com/en/) — Netflix. Official docs. Checked 2026-11.
[^14]: 📝 [Summary of June 8 outage](https://www.fastly.com/blog/summary-of-june-8-outage) — Fastly Blog, June 2021. Engineering blog. Checked 2026-11.
[^15]: 📝 [Valve's statement on the Steam Christmas incident](https://store.steampowered.com/news/19852) — Valve, Steam News, December 2015. Article. Checked 2026-11.
