---
aliases: [Load Balancing deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/performance]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Performance]]"
basics: "[[Load Balancing]]"
reading_time: 11 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Performance]] › [[Load Balancing]] › 🔬 Deep Dive

> [!tldr] For engineers
> A load balancer maps each **connection (layer 4) or request (layer 7)** to a healthy backend. L4 balancers hash the flow and forward packets, often with direct server return; L7 proxies terminate HTTP and route per request. The algorithm matters less than you'd think: **health checking, draining, connection stability when the pool changes, and not making the balancer itself a single point of failure** are where production systems succeed or fail.

> [!basics]- New to this? Start with the basics
> [[Load Balancing]] explains it with no jargon.

## How it really works

Large sites balance in **layers**: DNS spreads clients across addresses, routers spread packets across L4 balancers, L4 balancers spread connections across L7 proxies, and those proxies spread requests across application servers.

### DNS: the first, coarsest layer

An Elastic Load Balancing name resolves to the IP addresses of its load balancer nodes, one per enabled Availability Zone. The record has a **60-second TTL** so AWS can remap addresses quickly as it scales the balancer.[^1] Google's DNS likewise answers each user with the virtual IP (VIP) of a nearby frontend location, taking current load into account.[^2]

### Layer 4: packets and flows

An L4 balancer never parses HTTP. AWS's Network Load Balancer picks a target with a **flow hash** over protocol, source and destination IP and port, and TCP sequence number. It pins each TCP connection to one target for its lifetime.[^1]

Google's **Maglev** shows the full pattern.[^2] Every Maglev machine announces the same VIPs to the router over BGP. The router spreads packets across them with **ECMP** (equal-cost multipath). Each Maglev picks a backend, wraps the packet in GRE and forwards it. Replies use **direct server return**: they go straight to the router, bypassing Maglev, because responses are much larger than requests.[^2]

The hard problem is **connection stability**. Routers are stateless, so adding or removing a balancer reshuffles ECMP and moves some live connections to a machine that holds no state for them; GitHub's write-up shows those connections breaking.[^3] Maglev combines a per-machine **connection tracking** table with **consistent hashing**, so even a Maglev that has never seen a flow usually picks the same backend as its peers.[^2] GitHub's GLB uses a 65k-row rendezvous-hash table that gives each flow a primary and a secondary proxy. A proxy that receives a packet it doesn't recognize hands it to the secondary, a trick GitHub calls "second chance".[^3]

### Layer 7: requests

An L7 balancer terminates the client connection and routes on application data such as headers, cookies and URIs.[^4] An Application Load Balancer evaluates listener rules in priority order, then picks a target with the target group's algorithm. It multiplexes many client requests over fewer backend connections and adds `X-Forwarded-For` headers.[^1] The price is CPU for TLS and HTTP parsing; the reward is path routing, retries, header-based canaries and per-request balancing of long-lived HTTP/2 connections.

```nginx
upstream api {
    least_conn;
    server app1.internal:8080 weight=2 max_fails=3 fail_timeout=30s;
    server app2.internal:8080;
    server app3.internal:8080 backup;
}
server {
    location / { proxy_pass http://api; }
}
```

### Algorithms

- **(Weighted) round robin.** The default in NGINX and in ALB target groups.[^5][^6] It is fine when requests cost about the same and backends are identical.[^6]
- **Least connections / least outstanding requests.** Sends to the backend with the fewest in-flight requests, which suits requests of varying cost.[^6]
- **Power of two choices (P2C).** Sample two random backends and pick the less loaded. Envoy uses it by default for least-request balancing, noting that it is nearly as good as a full scan and resists herding.[^7] Mitzenmacher's supermarket-model analysis shows that going from one random choice to two gives an *exponential* improvement in time spent in the system, while a third choice adds only a constant factor.[^8]
- **Random.** Envoy notes it beats round robin when no health checks are configured, because round robin biases traffic toward the host that follows a failed one.[^7]
- **Hashing.** `ip_hash` or `hash $key` pins a client or key to a backend. Plain hashing remaps most keys when the pool changes; `hash ... consistent` (ketama) remaps only a few, which keeps cache hit ratios high.[^5] On a ring, adding or removing one of N hosts moves about 1/N of the keys. Envoy's Maglev table (size 65,537) builds and looks up faster than a ring but moves roughly twice as many keys on removal.[^7]

### Health checks

**Passive** checks watch real traffic. In NGINX, a server is marked unavailable after `max_fails` failures (default 1) within `fail_timeout` (default 10 s), and stays out for that same period.[^5] **Active** checks probe on a timer. ALB defaults: an HTTP GET to `/` every 30 s, 5 s timeout, 2 consecutive failures to mark unhealthy, 5 successes to mark healthy, success code 200.[^9]

Amazon distinguishes three depths: **liveness** (is the process up?), **local health** (disk, critical processes) and **dependency health** (can it reach its database?).[^10] Dependency checks catch expired credentials, but if a shared dependency fails, every server fails at once and automation removes the whole fleet.[^10] That's why many balancers **fail open**: when every target is unhealthy, ALB routes to all of them anyway.[^9]

### Draining, slow start and stickiness

On deregistration ALB stops sending new requests and waits **300 s** by default for in-flight ones (connection draining).[^6] **Slow start** ramps a new target's share linearly, so a freshly started server can warm up before it takes a full share.[^6] **Sticky sessions** bind a client to a target with a cookie (`AWSALB`, 7-day expiry); after a scale-up they can leave load uneven until stickiness is reset.[^6]

### Zones

With two Availability Zones, two targets in zone A and eight in zone B, each load balancer node gets 50% of traffic. With **cross-zone load balancing** each target receives 10%. Without it, zone A's two targets get 25% each and zone B's eight get 6.25% each.[^1]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| L4 (flow hash, DSR) | Millions of packets/s per box; protocol-agnostic | No per-request routing; one hot connection stays on one backend |
| L7 (HTTP proxy) | Path/header routing, retries, per-request balancing | TLS and parsing CPU; another hop of latency |
| Round robin | Simple, predictable | Ignores request cost and slow backends |
| Least requests / P2C | Adapts to uneven cost and slow hosts | Fast-failing hosts attract traffic |
| Consistent hashing | Cache affinity; minimal remapping | Hot keys overload one backend |
| Hardware pair (1+1) | Mature appliances | Half the capacity idle; scale-up means new hardware |
| Software fleet (N+1) | All capacity active; scale by adding servers | You own the software and its tuning |
| Sticky sessions | Works with stateful apps | Uneven load; failover loses the session |
| Cross-zone on | Even spread across all targets | Inter-zone traffic; a bad zone affects everyone |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Maglev line rate per machine | 10 Gbps: 813 Kpps at 1,500-byte packets, 9.06 Mpps at 100-byte packets[^2] |
| Maglev per-packet processing time | About 350 ns[^2] |
| Google Cloud load balancing ramp | 0 to 1 million requests/s with no pre-warming[^11] |
| GitHub GLB forwarding table | 65k rows, about 512 KB[^3] |
| Keys moved when one of N hosts changes (ring hash) | About 1/N[^7] |
| ALB health check defaults | 30 s interval, 5 s timeout, unhealthy after 2, healthy after 5[^9] |
| NGINX passive check defaults | max_fails 1, fail_timeout 10 s[^5] |
| ALB deregistration delay | 300 s[^6] |
| ELB DNS TTL | 60 s[^1] |
| Cross-zone off, 2 + 8 targets | 25% vs 6.25% per target, instead of 10% each[^1] |

## Failure modes

- **The balancer as a single point of failure.** Hardware pairs give only 1+1 redundancy and waste at least half their capacity.[^2][^11] Run an active-active fleet behind ECMP or anycast so losing one node only raises utilization on the rest.[^11]
- **Black-hole backends.** A server with a bug can fail requests *faster* than healthy ones. Least-requests algorithms then send it more traffic.[^10] Defend with outlier detection on error rates. ALB's Automatic Target Weights shifts traffic away from targets whose error rate stands out from their peers.[^6]
- **Health checks that are too deep.** A shared dependency blips, every server fails its check, and automation turns a partial outage into a total one.[^10] Keep fast checks local; let fail-open act as the backstop.[^9]
- **Health checks that are too shallow.** A process that is up but serving blank error pages passes liveness checks.[^10]
- **Zombie servers.** Hosts that return after a long outage may run old, incompatible code. Amazon reports software versions in health checks to catch them.[^10]
- **Connection resets on pool changes.** Naive ECMP or modulo hashing remaps live flows when balancers or backends change.[^3] Use connection tracking plus consistent or rendezvous hashing, and drain before removal.[^2][^6]
- **Empty zones.** With cross-zone balancing off, a zone with no healthy targets returns 503s for requests that land there.[^6]

## In the real world

- **Google Maglev** has served Google's traffic since 2008 on commodity Linux servers and powers Google Cloud's network load balancing.[^2]
- **GitHub GLB Director** is an open-source L4 balancer that sits in front of HAProxy and nginx and carries most of GitHub's web and git traffic.[^3]
- **AWS Elastic Load Balancing** offers ALB (L7, rule-based), NLB (L4, flow hash) and Gateway Load Balancer (5-tuple hash to appliances over GENEVE).[^1]
- **NGINX** offers round robin, least connections, IP hash, generic and consistent hash, least time and random with two choices.[^12]
- **Envoy** offers round robin, least request with P2C, ring hash, Maglev and random.[^7]

## In a design interview

Draw the layers and say what each one decides:

1. **Edge:** "DNS or anycast to the nearest region; a [[CDN]] for static content."
2. **L4:** "A managed network load balancer or an ECMP fleet; it only spreads connections."
3. **L7:** "An HTTP proxy that routes `/api` and `/static`, terminates TLS and uses least-outstanding-requests, because request cost varies."
4. **Health:** "Local health checks every few seconds, outlier ejection on 5xx rates, fail open as the last resort."
5. **State:** "App servers are stateless; sessions live in a shared store, so no sticky sessions."

Interviewers probe: *What if the load balancer dies?* (Active-active N+1, not a standby pair.) *How do you deploy without dropping requests?* (Drain, then remove; slow start on the way back.) *What happens to WebSockets during a scale-up?* (Connections stay pinned; rebalance by closing gradually.) *Why consistent hashing?* (Cache affinity with minimal remapping.)

## Check yourself

> [!question]- Why can least-outstanding-requests make a partial outage worse?
> A broken server that rejects requests instantly always has the fewest in-flight requests, so it attracts a growing share of traffic. You need error-rate-based outlier detection, not just load.

> [!question]- Your L4 tier uses ECMP and you add a fourth balancer. Some users' downloads break. Why, and how do Maglev and GLB prevent it?
> ECMP rehashes flows across the new set, so some live connections land on a balancer with no state for them. Maglev's consistent hashing makes every balancer choose the same backend for a flow; GLB's rendezvous table plus "second chance" forwarding lets an unfamiliar packet reach the proxy that owns it.

> [!question]- With cross-zone balancing off, zone A has 2 targets and zone B has 8. What share does each target get, and why does it matter?
> Each node gets 50%, so zone A's targets get 25% each and zone B's 6.25% each. Zone A's servers run four times hotter, so you either balance target counts per zone or turn cross-zone on.

## Further reading

- 🔬 [Maglev: A Fast and Reliable Software Network Load Balancer](https://www.usenix.org/conference/nsdi16/technical-sessions/presentation/eisenbud) — the reference design for software L4 balancing at planetary scale.
- 📝 [GLB: GitHub's open source load balancer](https://github.blog/engineering/infrastructure/glb-director-open-source-load-balancer/) — the clearest explanation of why ECMP breaks connections and how to fix it.
- 📝 [Implementing health checks](https://builder.aws.com/content/3Ev53O39izHCtWLzp4XU6t8PC1O/implementing-health-checks) — hard-won lessons on check depth, fail-open and black holes.
- 📄 [Envoy supported load balancers](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers) — concise comparison of P2C, ring hash and Maglev hashing.
- 🔬 [The Power of Two Choices in Randomized Load Balancing](https://www.eecs.harvard.edu/~michaelm/abstracts/tpds2001.html) — the result behind P2C.

## Related

- [[Caching (Deep Dive)]] — consistent hashing keeps cache shards warm behind a balancer.
- [[CDN (Deep Dive)]] — anycast and tiered routing at the global edge.
- [[Sharding (Deep Dive)]] — the same hashing ideas applied to data placement.
- [[Fault Tolerance (Deep Dive)]] — health checks, failover and blast radius.
- [[Microservices (Deep Dive)]] — client-side and sidecar balancing between services.
- [[LLM Inference & Optimization (Deep Dive)]] — routing requests across GPU replicas with very uneven cost.

> [!nav] Keep going
> ← [[CDN (Deep Dive)|CDN]] · [[Performance|⚡ Performance]] · [[Message Queues (Deep Dive)|Message Queues]] →
> 🌱 Back to the basics: [[Load Balancing]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html) — Elastic Load Balancing User Guide. Official docs. Checked 2026-11.
[^2]: 🔬 [Maglev: A Fast and Reliable Software Network Load Balancer (full paper, PDF)](https://www.usenix.org/system/files/conference/nsdi16/nsdi16-paper-eisenbud-update.pdf) — Eisenbud et al., USENIX NSDI 2016, sections 1–3. Paper. Checked 2026-11.
[^3]: 📝 [GLB: GitHub's open source load balancer](https://github.blog/engineering/infrastructure/glb-director-open-source-load-balancer/) — GitHub Engineering Blog, August 2018. Engineering blog. Checked 2026-11.
[^4]: 📄 [Load Balancer](https://www.f5.com/glossary/load-balancer) — F5 Glossary. Official docs. Checked 2026-11.
[^5]: 📄 [Module ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) — nginx.org documentation. Official docs. Checked 2026-11.
[^6]: 📄 [Edit target group attributes for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html) — Elastic Load Balancing, Application Load Balancers guide. Official docs. Checked 2026-11.
[^7]: 📄 [Supported load balancers](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers) — Envoy Proxy documentation. Official docs. Checked 2026-11.
[^8]: 🔬 [The Power of Two Choices in Randomized Load Balancing](https://www.eecs.harvard.edu/~michaelm/abstracts/tpds2001.html) — Michael Mitzenmacher, Harvard University. Paper. Checked 2026-11.
[^9]: 📄 [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html) — Elastic Load Balancing, Application Load Balancers guide. Official docs. Checked 2026-11.
[^10]: 📝 [Implementing health checks](https://builder.aws.com/content/3Ev53O39izHCtWLzp4XU6t8PC1O/implementing-health-checks) — Amazon Builders' Library. Article. Checked 2026-11.
[^11]: 📝 [Google shares software network load balancer design powering GCP networking](https://cloud.google.com/blog/products/gcp/google-shares-software-network-load-balancer-design-powering-gcp-networking/) — Google Cloud Blog, March 2016. Engineering blog. Checked 2026-11.
[^12]: 📄 [HTTP Load Balancing](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/) — NGINX Documentation. Official docs. Checked 2026-11.
