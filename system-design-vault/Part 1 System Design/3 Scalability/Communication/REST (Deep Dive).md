---
aliases: [REST deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/communication]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Communication]]"
basics: "[[REST]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Communication]] › [[REST]] › 🔬 Deep Dive

> [!tldr] For engineers
> REST is an **architectural style**, not a protocol: client-server, stateless, cacheable, layered, with a **uniform interface** over named resources. Over HTTP that means honoring method semantics (safe, idempotent, cacheable), using status codes and conditional requests properly, and, for the purist's "Level 3", driving clients with hypermedia links. The style trades raw efficiency for evolvability, visibility and Internet-scale caching.

> [!basics]- New to this? Start with the basics
> [[REST]] explains it with no jargon.

## How it really works

### Fielding's constraints

Roy Fielding's 2000 dissertation derives REST by adding constraints one at a time to a null style.[^1] Each buys a property and costs something:

| Constraint | Buys | Costs |
| --- | --- | --- |
| Client-server | Separation of concerns; independent evolution | A network hop |
| Stateless | Visibility, reliability, scalability | Repeated per-request data; less server control over app behavior |
| Cache | Fewer interactions, lower average latency | Stale data can reduce reliability |
| Uniform interface | Simplicity, decoupling, visible interactions | Efficiency: data travels in a standard, not app-specific, form |
| Layered system | Proxies, gateways, shared caches, load balancing | Added latency per layer |
| Code-on-demand (optional) | Extensible clients (scripts) | Reduced visibility |

Statelessness means each request "must contain all of the information necessary to understand the request".[^1] That lets requests be processed in parallel, lets an intermediary understand a request in isolation, and forces everything that affects cacheability into the request itself.[^1] It is why any instance behind a [[Load Balancing|load balancer]] can serve any call.

The **uniform interface** has four sub-constraints: identification of resources; manipulation of resources through representations; self-descriptive messages; and hypermedia as the engine of application state (HATEOAS).[^1] A **resource** is "any information that can be named", a conceptual mapping rather than a specific row in a table.[^1] Fielding notes the interface is designed to be efficient for large-grain hypermedia transfer and is "not optimal for other forms of architectural interaction".[^1]

### HTTP method semantics

RFC 9110 defines the properties that intermediaries, retry logic and caches rely on.[^2] PATCH comes from a separate RFC and, like POST, is not guaranteed to be idempotent.[^3]

| Method | Typical use | Safe | Idempotent | Caching semantics defined |
| --- | --- | --- | --- | --- |
| GET | Read a resource | Yes | Yes | Yes |
| HEAD | Read headers only | Yes | Yes | Yes |
| POST | Create in a collection, or process | No | No | Yes, but rarely implemented by caches |
| PUT | Replace (or create at a known URI) | No | Yes | No |
| PATCH | Partial update | No | No | No |
| DELETE | Remove | No | Yes | No |

A client should not automatically retry a non-idempotent request unless it has some means to know that is safe, and a proxy must not.[^2] That is why payment APIs bolt **idempotency keys** onto POST (see [[API Design (Deep Dive)]]).

Conventions on top: `POST /customers` returns `201 Created` with a `Location` header for the new URI; `PUT` must be idempotent; a long-running operation returns `202 Accepted` plus a status URI to poll.[^3]

### PUT vs PATCH

`PUT` sends the full representation. `PATCH` sends only changes, in one of two common formats:[^3]

```http
PATCH /products/7 HTTP/1.1
Content-Type: application/merge-patch+json

{ "price": 12, "color": null, "size": "M" }
```

**JSON Merge Patch** (RFC 7396) mirrors the resource shape, and `null` deletes a field, so it cannot set a field to an explicit null.[^3] **JSON Patch** (RFC 6902, `application/json-patch+json`) is an ordered list of operations such as `add`, `remove`, `replace`, `copy` and `test`.[^3] Useful PATCH errors: `400` malformed patch, `409` valid patch but conflicting state, `415` unsupported patch format.[^3]

### Status codes

Codes fall into five classes: 1xx informational, 2xx success, 3xx redirection, 4xx client error, 5xx server error.[^4] The ones worth precision: `401` means unauthenticated while `403` means the identity is known but not allowed; `409` signals a conflict with current state; `429` means rate-limited.[^4]

### Conditional requests

Responses carry an `ETag` (and often `Last-Modified`). The client echoes it in `If-None-Match`; if nothing changed the server returns a bodyless `304 Not Modified`.[^5] On GitHub, a correctly authorized `304` does not count against the primary rate limit.[^5] The same mechanism with `If-Match` on writes gives optimistic concurrency. (For cache headers in depth, see [[Caching (Deep Dive)]].)

### Hypermedia and the Richardson Maturity Model

Leonard Richardson's 2008 model grades HTTP APIs in four levels.[^3] Martin Fowler's write-up uses a doctor's-appointment example:[^6]

- **Level 0:** one endpoint, everything is a POST of XML or JSON; errors come back as `200` with an error body.
- **Level 1:** separate resources (`/doctors/mjones`, `/slots/1234`).
- **Level 2:** proper verbs and status codes (`201 Created`, `409 Conflict` when a slot is taken). Many published APIs sit roughly here.[^3]
- **Level 3:** hypermedia controls, links in each response telling the client what it can do next.

Fowler reports that Fielding considers Level 3 a precondition of REST.[^6] Microsoft notes there is no general-purpose standard for modeling HATEOAS links.[^3]

```json
{ "orderID": 3, "quantity": 4,
  "links": [ { "rel": "customer", "href": "https://api.contoso.com/customers/3", "action": "GET" } ] }
```

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| REST over HTTP/JSON | Universal tooling, human-readable, cacheable GETs | Verbose text payloads; no enforced schema |
| Level 2 (verbs + codes) | What clients expect; easy to document | Clients hard-code URIs |
| Level 3 (HATEOAS) | Server can move URIs; discoverable flows | No standard format; few clients use links |
| PUT (full replace) | Idempotent, simple semantics | Must send whole resource; lost-update risk without `If-Match` |
| PATCH (partial) | Small payloads | Not idempotent by definition; two patch formats |
| Fine-grained resources | Clean model, cacheable | Chatty: many round trips per screen |
| Bulk or composite endpoints | Fewer calls | Bigger payloads, partial failures |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| GitHub REST primary rate limit, unauthenticated | 60 requests/hour per IP[^7] |
| GitHub REST primary rate limit, authenticated | 5,000 requests/hour[^7] |
| GitHub limit for Enterprise Cloud-owned apps | 15,000 requests/hour[^7] |
| GitHub guidance between mutating requests | Wait at least 1 second[^5] |
| HTTP status code classes | 5 (1xx–5xx)[^4] |
| Example default page size in Microsoft's guidance | `limit=25`[^3] |
| Fielding's dissertation | 2000[^1] |
| Current HTTP semantics spec | RFC 9110, June 2022[^2] |

## Failure modes

- **Duplicate creates.** A POST times out and is retried. Use idempotency keys, or PUT to a client-chosen URI when the client can name the resource.[^2][^3]
- **Errors hidden in 200s.** Level-0 APIs return `200` with an error body, so caches, monitors and retry logic treat failures as successes.[^6]
- **Lost updates.** Two clients GET, edit and PUT; the second silently overwrites the first. Use ETags with `If-Match` and return `409` or `412` on mismatch.
- **Chattiness.** Rendering one page needs dozens of calls. Add bulk operations or composite resources.[^3]
- **Cache duplication by version.** Header- or media-type-based versioning can fill shared caches with near-identical copies per version.[^3]
- **Stale caches.** Cacheable responses trade freshness for speed; Fielding notes stale cached data can reduce reliability.[^1]
- **Rate-limit lockouts.** Clients that poll or fire requests concurrently hit `403`/`429`. Honor `retry-after` and `x-ratelimit-reset`, back off, and prefer webhooks to polling.[^7][^5]

## In the real world

- **GitHub REST API**: date-based versions via `X-GitHub-Api-Version`, `application/vnd.github+json` media type, ETags on most endpoints, and documented rate-limit headers.[^8][^5][^7]
- **Microsoft Azure Architecture Center** publishes a full REST guideline covering URIs, methods, patch formats, async 202 flows and versioning.[^3]
- **The Web itself** is the original REST system: Fielding wrote the style to describe it.[^1]

## In a design interview

Sketch resources first, then verbs:

1. "`POST /rides` → `201` + `Location: /rides/{id}`; `GET /rides/{id}`; `PATCH /rides/{id}` for status."
2. "Lists: `GET /users/{id}/rides?cursor=…&limit=20`."
3. "Retries: idempotency key on POST; PUT and DELETE are naturally idempotent."
4. "Caching: ETags on GETs; `Cache-Control` on public data."
5. "Errors: 4xx for caller mistakes, 5xx for server faults, `429` with `Retry-After` when throttled."

Probes to expect: *PUT vs PATCH?* *Why stateless?* (Horizontal scale.) *Is your API really RESTful?* (Level 2 is honest; say so.) *When not REST?* (Internal high-throughput calls → [[gRPC (Deep Dive)|gRPC]]; server push → [[WebSockets (Deep Dive)|WebSockets]].)

## Check yourself

> [!question]- Why is PUT idempotent but PATCH not, by definition?
> PUT replaces the whole resource with the given representation, so repeating it lands in the same state. A PATCH can be relative (for example, "append to list"), so repeating it can change state again.

> [!question]- What does the stateless constraint cost, according to Fielding?
> Network efficiency: repetitive per-request data (credentials, context) must be sent every time, and the server has less control over consistent application behavior across client versions.

> [!question]- A client polls `GET /repos/x` every minute and keeps hitting rate limits. What two changes help most?
> Send `If-None-Match` with the stored ETag so unchanged responses are cheap `304`s, and switch to webhooks instead of polling.

## Further reading

- 📘 [Fielding, chapter 5: Representational State Transfer](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) — the primary source; short and surprisingly readable.
- 📝 [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html) — the clearest walk from RPC-over-HTTP to hypermedia.
- 📄 [Web API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design) — a practical, opinionated REST checklist.
- 📄 [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — what a large public API asks of its clients.
- 📄 [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — the authoritative method and status definitions.

## Related

- [[API Design (Deep Dive)]] — versioning, pagination and idempotency keys.
- [[gRPC (Deep Dive)]] — the typed, binary alternative for internal calls.
- [[Caching (Deep Dive)]] — HTTP caching headers and revalidation.
- [[Rate Limiting (Deep Dive)]] — how limits like GitHub's are enforced.
- [[Networking (Deep Dive)]] — HTTP and TCP beneath REST.
- [[Deployment & Serving (Deep Dive)]] — model endpoints exposed over HTTP.

> [!nav] Keep going
> ← [[API Design (Deep Dive)|API Design]] · [[Communication|💬 Communication]] · [[gRPC (Deep Dive)|gRPC]] →
> 🌱 Back to the basics: [[REST]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📘 [Architectural Styles and the Design of Network-based Software Architectures, chapter 5: REST](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) — Roy T. Fielding, University of California, Irvine, 2000. Dissertation. Checked 2026-11.
[^2]: 📄 [RFC 9110: HTTP Semantics, section 9.2](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Standard. Checked 2026-11.
[^3]: 📄 [Web API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design) — Microsoft Azure Architecture Center. Official docs. Checked 2026-11.
[^4]: 📄 [HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) — MDN Web Docs. Official docs. Checked 2026-11.
[^5]: 📄 [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — GitHub Docs. Official docs. Checked 2026-11.
[^6]: 📝 [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html) — Martin Fowler, 2010. Article. Checked 2026-11.
[^7]: 📄 [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — GitHub Docs. Official docs. Checked 2026-11.
[^8]: 📄 [Getting started with the REST API](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api) — GitHub Docs. Official docs. Checked 2026-11.
