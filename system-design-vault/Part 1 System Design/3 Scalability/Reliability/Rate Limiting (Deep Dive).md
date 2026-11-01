---
aliases: [Rate Limiting deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/reliability]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Reliability]]"
basics: "[[Rate Limiting]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Reliability]] › [[Rate Limiting]] › 🔬 Deep Dive

> [!tldr] For engineers
> A rate limiter is **admission control keyed by caller identity**: pick a key, count with an algorithm, decide (allow, reject or delay), and signal the client with `429` and headers. Token bucket and sliding-window counter dominate because they need constant memory per key. The hard parts are atomic counting across many servers, choosing where to enforce, and failing open when the limiter itself breaks.

> [!basics]- New to this? Start with the basics
> [[Rate Limiting]] explains it with no jargon.

## How it really works

Every limiter answers four questions: **who is the caller** (user, API key, IP, endpoint), **how do you count**, **where do you enforce**, and **what do you tell the client**.

### The five algorithms

| Algorithm | State per key | Accuracy | Bursts | Good for |
| --- | --- | --- | --- | --- |
| Fixed window | 1 counter | Approximate | Up to 2x at window edges | Simple limits, login throttling |
| Sliding window log | One entry per request | Exact | None | Low-volume, high-value APIs |
| Sliding window counter | 2 counters | Near-exact | Smoothed | General-purpose API limits |
| Token bucket | Tokens + last refill time | Exact | Controlled, up to capacity | Bursty clients with an average cap |
| Leaky bucket | Level + last drain time | Exact | None | Strict pacing |

All five rows come from Redis's comparison of its reference implementations.[^1]

**Fixed window** increments a counter keyed by window number and expires it with the window. Its flaw: a client can send a full quota at the end of one window and another at the start of the next.[^1] **Sliding window log** stores a timestamp per request in a sorted set, trims old entries and counts the rest; it is exact, but a 10,000-per-hour limit can mean 10,000 entries per client.[^1] **Sliding window counter** keeps the current and previous window counts and estimates `prev × (1 − elapsed) + current`.[^1]

**Token bucket**: tokens arrive at rate *r* into a bucket of capacity *b*, and a request proceeds only if a token is available. Over the long run, throughput is limited to *r*, while bursts up to *b* pass immediately.[^2][^1] **Leaky bucket** has two forms. As a meter, it is a mirror image of the token bucket and classifies the same requests as conforming; as a queue, it shapes traffic into a jitter-free output stream.[^2][^1] Redis calls these **policing** (reject now) and **shaping** (delay).[^1]

You never need a timer to refill tokens. Compute them lazily on each request:

```python
def allow(key, capacity, rate, now):
    tokens, last = store.get(key, default=(capacity, now))
    tokens = min(capacity, tokens + (now - last) * rate)   # lazy refill
    if tokens >= 1:
        store.set(key, (tokens - 1, now))
        return True
    store.set(key, (tokens, now))
    return False
```

### Counting across many servers

The pattern is read state, decide, write state. Run those as separate commands and two concurrent requests can both read the same count, both pass and both write, a time-of-check-to-time-of-use race.[^1] In Redis, wrap the logic in a Lua script, which executes atomically on the server in one round trip; in Redis Cluster all keys a script touches must hash to the same slot, so multi-key limiters use hash tags.[^1]

Cloudflare took another route at the edge. Anycast sends a given IP to the same point of presence (PoP), so each PoP counts in isolation, with memcache sharded by consistent hashing behind Twemproxy.[^3] Increments run asynchronously; when a client crosses the threshold, a mitigation flag is set for the whole PoP, and request handling checks only that flag.[^3] The window is a sliding-counter approximation: with a 50-per-minute limit, 42 requests last minute and 18 in the first 15 seconds of this one, the estimate is `42 × 0.75 + 18 = 49.5`.[^3]

Stripe keeps its token buckets in Redis.[^4] Envoy offers two tiers: a **local** token bucket inside each proxy, and a **global** gRPC rate-limit service, with a Go reference implementation backed by Redis.[^5] Envoy recommends combining them so the local bucket absorbs very large bursts before they reach the global service.[^5]

### Telling the client

HTTP `429 Too Many Requests` means "too many requests in a given amount of time"; the response should explain the condition and may carry `Retry-After`.[^6] The RFC deliberately leaves out how the server identifies users or counts requests.[^6]

Limit headers are not yet standard. The IETF `RateLimit-Policy` and `RateLimit` fields (quota `q`, window `w`, remaining `r`, effective window `t`) are still an Internet-Draft, revision 11 dated May 2026.[^7] Meanwhile GitHub sends `x-ratelimit-limit`, `-remaining`, `-used`, `-reset` and `-resource`.[^8]

### Rate limiting vs. load shedding

A rate limiter protects fairness per caller; a load shedder protects the service as a whole. Stripe runs both: a request-rate limiter and a concurrent-requests limiter per user, then a fleet usage shedder and a worker utilization shedder for incidents.[^4] The fleet shedder reserves 20% of capacity for critical methods such as creating charges, so non-critical traffic over its 80% share gets `503`.[^4] Google adds **client-side adaptive throttling**: each client tracks requests and accepts over two minutes and starts rejecting locally once requests exceed K times accepts, with K = 2 preferred.[^9]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Token bucket | Bursts allowed; O(1) state | Two parameters to tune; float drift |
| Sliding window counter | Smooth; two counters | Approximate at edges[^3] |
| Sliding window log | Exact; audit trail | Memory grows with traffic[^1] |
| Central store (Redis) | One global count | Extra hop; store outage risk |
| Local per-node limits | No network hop | Limit scales with node count; uneven |
| Local + global tiers | Bursts absorbed locally | Two systems to run[^5] |
| Reject (policing) | Immediate answer | Client must retry |
| Delay (shaping) | Smooth downstream load | Added latency; queue limits[^1] |
| Fail open on limiter error | API stays up | Brief unprotected window[^4] |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Cloudflare approximation error | 0.003% of 400 million requests wrongly allowed or limited; 6% average rate difference[^3] |
| GitHub REST primary limits | 60/h anonymous; 5,000/h authenticated; 15,000/h for Enterprise Cloud apps[^8] |
| GitHub secondary limits | 100 concurrent requests; 900 points/min for REST[^8] |
| Stripe concurrent limit example | 20 requests in progress per user[^4] |
| Stripe fleet shedder | 20% reserved for critical requests[^4] |
| Stripe worker shedder | Only 100 rejections in one month[^4] |
| Google adaptive throttling | K = 2: reject locally once requests exceed 2x accepts[^9] |

## Failure modes

- **Limiter outage takes the API down.** Stripe catches errors at every level so a bug or Redis outage fails open.[^4]
- **Race conditions.** Non-atomic read-modify-write lets concurrent requests exceed the limit; use atomic scripts.[^1]
- **Boundary bursts.** Fixed windows can admit double the limit around the edge.[^1]
- **Retry storms after 429.** Clients that hammer a limited API make it worse. GitHub says to wait for `retry-after` or `x-ratelimit-reset`, back off exponentially, and warns that ignoring limits can get an integration banned.[^8]
- **Throttling good customers.** A new limit can block legitimate traffic. Stripe dark-launches each limiter, watches what it would block, and keeps feature-flag kill switches.[^4]
- **Rejection overload.** Rejecting still costs CPU; at scale a backend can drown in rejections, which is why Google throttles at the client too.[^9]
- **Overrun.** Gateways treat limits as best-effort targets; bursts can exceed them.[^10]

## In the real world

- **Stripe** runs four limiters on Redis token buckets and recommends starting with the request-rate limiter.[^4]
- **Cloudflare** counts per PoP with a sliding-window approximation that needs two numbers per counter.[^3]
- **GitHub** publishes primary, secondary and points-based limits with response headers.[^8]
- **Amazon API Gateway** uses a token bucket where a token is a request, and checks limits in order: per-client or per-method in a usage plan, per-method stage limits, account-level per Region, then AWS Regional throttling.[^10]
- **Envoy** pairs local token buckets with a global rate-limit service.[^5]

## In a design interview

"Design a rate limiter" is a classic. A tight answer:

1. **Requirements:** "Per API key, 100 requests/s with bursts to 200; also a per-IP limit for anonymous traffic."
2. **Algorithm:** "Token bucket, capacity 200, refill 100/s."
3. **Placement:** "In the API gateway, before auth-heavy work; a local bucket per gateway node plus a Redis-backed global check."
4. **Atomicity:** "One Lua script per check; keys hashed by API key across a Redis cluster."
5. **Response:** "`429` with `Retry-After` and remaining-quota headers."
6. **Failure:** "Fail open with an alert; dark-launch new limits."

Interviewers probe: *Why not a fixed window?* (Edge bursts.) *What if Redis is slow?* (Local tier, timeouts, fail open.) *How do you limit across regions?* (Per-region budgets, or accept approximate global counts.)

## Check yourself

> [!question]- A token bucket has capacity 10 and refills 1 token per second. A client is idle for a minute, then sends 25 requests at once. How many pass?
> Ten pass immediately, since the bucket caps at 10 tokens. The other 15 are rejected, and the client then gets about one request per second.

> [!question]- Why is the leaky bucket "as a meter" equivalent to a token bucket?
> One counts tokens down as requests spend them; the other counts the level up as requests fill it. With the same parameters they accept exactly the same requests.

> [!question]- Your limiter's Redis cluster is down. Should requests be rejected?
> Usually no. Fail open, alert loudly, and rely on local per-node limits and load shedding for protection, as Stripe does.

## Further reading

- 📝 [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) — four production limiters and how to roll them out safely.
- 📝 [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) — the sliding-window approximation, with accuracy data.
- 📄 [Build 5 Rate Limiters with Redis](https://redis.io/tutorials/howtos/ratelimiting/) — every algorithm with atomic Lua code.
- 📄 [Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting) — local plus global limits in a service mesh.
- 📘 [Handling Overload](https://sre.google/sre-book/handling-overload/) — per-customer quotas and client-side throttling at Google.

## Related

- [[API Design (Deep Dive)]] — limits, headers and error contracts.
- [[Fault Tolerance (Deep Dive)]] — load shedding, retries and backoff.
- [[Caching (Deep Dive)]] — Redis, the usual home for counters.
- [[Load Balancing (Deep Dive)]] — gateways and proxies where limits are enforced.
- [[Authentication (Deep Dive)]] — the identity a limit is keyed on.
- [[LLM Inference & Optimization (Deep Dive)]] — scarce GPU capacity behind AI APIs.

> [!nav] Keep going
> ← [[Fault Tolerance (Deep Dive)|Fault Tolerance]] · [[Reliability|🛡️ Reliability]] · [[Authentication (Deep Dive)|Authentication]] →
> 🌱 Back to the basics: [[Rate Limiting]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Build 5 Rate Limiters with Redis](https://redis.io/tutorials/howtos/ratelimiting/) — William Johnston, Redis, 2026. Official docs. Checked 2026-11.
[^2]: 📖 [Token bucket](https://en.wikipedia.org/wiki/Token_bucket) — Wikipedia. Encyclopedia. Checked 2026-11.
[^3]: 📝 [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) — Cloudflare Blog, 2017. Engineering blog. Checked 2026-11.
[^4]: 📝 [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) — Paul Tarjan, Stripe Engineering, 2017. Engineering blog. Checked 2026-11.
[^5]: 📄 [Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting) — Envoy Proxy documentation. Official docs. Checked 2026-11.
[^6]: 📄 [RFC 6585: Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585.html) — Nottingham & Fielding, IETF, 2012. Standard. Checked 2026-11.
[^7]: 📄 [RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) — IETF HTTPAPI Working Group, Internet-Draft 11, 2026. Standard (draft). Checked 2026-11.
[^8]: 📄 [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — GitHub Docs. Official docs. Checked 2026-11.
[^9]: 📘 [Handling Overload](https://sre.google/sre-book/handling-overload/) — Site Reliability Engineering, Google (O'Reilly). Book chapter. Checked 2026-11.
[^10]: 📄 [Throttle requests to your REST APIs for better throughput in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html) — Amazon API Gateway Developer Guide. Official docs. Checked 2026-11.
