---
aliases: [API Design deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/communication]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Communication]]"
basics: "[[API Design]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Communication]] › [[API Design]] › 🔬 Deep Dive

> [!tldr] For engineers
> An API is a **long-lived contract**: once clients ship against it, every change must be wire-, source- and semantically compatible or go out behind a version. Three mechanics carry most of the load at scale: **additive evolution plus explicit versioning**, **opaque cursor pagination** designed in from day one, and **idempotency keys** so retries over an unreliable network never double-apply a mutation.

> [!basics]- New to this? Start with the basics
> [[API Design]] explains it with no jargon.

## How it really works

### The contract and its description

An API has a client that sends requests and a server that answers, under a documented contract of service.[^1] For HTTP APIs that contract is usually written down in **OpenAPI**, a language-agnostic description that lets humans and tools discover a service's capabilities without reading its source.[^2] Two broad styles exist: **resource-oriented** ([[REST]]: nouns plus a fixed verb set, e.g. `GET /customers/5/orders`) and **RPC-style** ([[gRPC]]: named methods such as `CreateOrder`). Resource URIs should be nouns, collections plural, and relationships shallow; the HTTP method already carries the verb.[^3]

### Compatibility is the real design constraint

Google's AIP-180 splits compatibility into three kinds:[^4]

- **Source:** code written against the old version still compiles against the new client library.
- **Wire:** an old client still talks correctly to a new server.
- **Semantic:** an old client still gets what a reasonable developer would expect.

Within a major version, you may **add** methods, messages, fields and enum values, but you must not remove or rename anything, change a field's type (even to a wire-compatible one), change a default, move a field into or out of a `oneof`, or add a new required request field.[^4] Renaming is treated as remove-plus-add, so the old name has to stay.[^4] Stripe's rule of thumb is the same: adding an endpoint, or a field that was never there before, is safe; existing fields keep their name and type.[^5]

### Versioning strategies

When a breaking change is unavoidable, it ships behind a version. Microsoft's guidance lists four placements:[^3]

| Placement | Example | Notes |
| --- | --- | --- |
| URI | `/v2/customers/3` | Simple, cache-friendly; URIs multiply and every hypermedia link must carry the version |
| Query string | `/customers/3?version=2` | Same URI per resource; still cache-friendly |
| Header | `Custom-Header: api-version=2` | Clean URIs; caches may store duplicate copies per version |
| Media type | `Accept: application/vnd.contoso.v1+json` | Fits hypermedia well; more parsing logic |

Stripe takes a different route: **rolling, date-named versions** (e.g. `2017-05-24`). An account is pinned to the newest version on its first request, and a single call can override it with the `Stripe-Version` header.[^5] Internally, each breaking change is a **version change module** that transforms responses; the server walks modules backwards from the current version to the caller's pinned one.[^5] GitHub's REST API also uses dated versions, sent in an `X-GitHub-Api-Version: 2022-11-28` header.[^6]

```text
current schema ──► [2024-xx module] ──► [2023-xx module] ──► response shaped for a client pinned to 2023-01
```

### Pagination

**Offset pagination** (`?limit=25&offset=50`) is simple and lets clients jump to page N.[^3] It degrades on deep pages because the database reads `offset + count` rows and discards the offset, and on fast-changing data it **skips or duplicates** items as the window shifts.[^7]

**Cursor pagination** returns an opaque token that encodes where to resume. Slack's cursors are Base64 encodings of strings such as `user:W07QCRPA4`. The server turns the cursor into a `WHERE` clause on an indexed column (roughly `WHERE id <= :cursor ORDER BY id DESC LIMIT :n+1`), so it never re-reads earlier rows, and fetching one extra row tells it whether a next page exists.[^7]

```json
{ "members": [ ... ], "response_metadata": { "next_cursor": "dXNlcjpXMDdRQ1JQQTQ=" } }
```

Google's AIP-158 codifies the rules:[^8]

- `page_size` and `page_token` are optional; oversized requests are coerced down to the maximum, negative ones rejected.
- An empty `next_page_token` is the **only** end-of-collection signal.
- Tokens must be opaque and URL-safe, and Base64 of a readable token is not enough obfuscation. Tokens must never grant authorization.
- **Paginate from day one:** adding pagination to an existing list method is a backwards-incompatible change, because old clients assume they got everything.

### Idempotency and safe retries

HTTP already classifies methods. GET, HEAD, OPTIONS and TRACE are **safe**; those plus PUT and DELETE are **idempotent**; and a client should not automatically retry a non-idempotent request unless it has some way to know it is safe.[^9] POST and PATCH are the problem.

A network call can fail before it reaches the server, midway through the work, or after success with the reply lost, and the client cannot tell the last two apart.[^10] An **idempotency key** fixes this: the client generates a unique value (Stripe suggests a V4 UUID, up to 255 characters) and sends it with the mutation.[^11]

```python
def handle_post(req):
    key = req.headers["Idempotency-Key"]
    saved = store.get(key)
    if saved:
        if saved.params_hash != hash(req.body):
            return error(422)            # same key, different payload
        return saved.response            # replay, don't re-execute
    with store.lock(key):                # concurrent duplicate gets 409
        resp = execute(req)
        store.put(key, req.body, resp, ttl=24 * 3600)
    return resp
```

Stripe's v1 API stores the status code and body of the first request once execution begins, including `500`s, compares parameters on reuse, and may prune keys after 24 hours.[^11] An IETF draft, `draft-ietf-httpapi-idempotency-key-header` (revision 08, October 2026, still a draft), standardizes the `Idempotency-Key` header and suggests `400` for a missing key, `422` for a reused key with a different payload, and `409` while the original request is still in flight.[^12]

Retries need pacing as well as keys. Stripe recommends **exponential backoff** (wait grows like 2ⁿ after n failures) plus random **jitter**, so clients that failed together don't hammer a recovering server in lockstep.[^10]

### Long-running operations

If a mutation takes too long to finish inline, return `202 Accepted` with a `Location` header pointing at a status resource the client can poll.[^3]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| URI versioning (`/v2/`) | Obvious, cache-friendly, easy routing | Big-bang migrations; URIs and links multiply |
| Dated rolling versions (Stripe) | Small, incremental upgrades; per-request override | Server keeps transformation code for every old version |
| Offset pagination | Jump to page N; total counts | Slow deep pages; skips/duplicates under writes |
| Cursor pagination | Index-backed, stable under writes | No random access, no totals; needs a unique sort key |
| Client-generated idempotency keys | Safe retries of POST | Key store, TTLs, concurrency handling |
| Fine-grained endpoints | Simple, composable | Chatty: many round trips per screen |
| Coarse or batch endpoints | Fewer round trips | Larger payloads, harder partial failure |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Stripe API compatibility | Every version kept working since 2011[^5] |
| Stripe breaking changes shipped via versioning | Almost 100 in six years (as of 2017)[^5] |
| Stripe idempotency key length / retention | Up to 255 characters; prunable after 24 h[^11] |
| AIP-158 example max page size | Requests above 1,000 coerced to 1,000[^8] |
| AIP-158 page-token expiry rule of thumb | About 3 days[^8] |
| Microsoft example default page | `limit=25&offset=0`[^3] |
| Slack collection growth that forced cursors | Several hundred → hundreds of thousands of records[^7] |

## Failure modes

- **Double-applied mutations.** A POST times out, the client retries, and the customer is charged twice. Defend with idempotency keys on every mutating endpoint.[^11]
- **Key misuse.** A client reuses a key with a different body. Hash and compare the payload and reject the mismatch.[^12]
- **Retry storms.** Thousands of clients retry on the same schedule after an outage. Exponential backoff with jitter, and server-side [[Rate Limiting]].[^10]
- **Silent semantic breaks.** The schema is unchanged but a field's meaning or format shifts. AIP-180 forbids changing a field's format or default within a major version.[^4]
- **Pagination bolted on later.** Old clients that assumed one response held everything now silently miss data.[^8]
- **Leaky cursors.** Clients parse "opaque" tokens and break when you change them; or a token doubles as an access grant. Make tokens genuinely opaque and re-check authorization on every page.[^8]
- **Version sprawl.** Every supported version is more code to maintain; Stripe isolates old behavior in change modules to keep that cost fixed.[^5]

## In the real world

- **Stripe** popularized dated versions with account pinning, and idempotency keys on every POST.[^5][^11]
- **Google** publishes its API Improvement Proposals (AIPs) as a public style guide; AIP-158 and AIP-180 are the canonical references for pagination and compatibility.[^8][^4]
- **Slack** moved its Web API from offset to cursor pagination and returns `next_cursor` in `response_metadata`.[^7]
- **GitHub** versions its REST API by date through a request header.[^6]
- **Microsoft Azure** documents URI, query, header and media-type versioning side by side.[^3]

## In a design interview

Walk the contract before the boxes:

1. **Resources and operations.** "`POST /orders`, `GET /orders/{id}`, `GET /users/{id}/orders?page_token=`."
2. **Retries.** "Order creation takes an `Idempotency-Key`; key → response is stored for 24 hours."
3. **Lists.** "Cursor pagination on `(created_at, id)`, default page 25, max 100."
4. **Evolution.** "Additive changes only within v1; breaking changes go to v2 or a dated version."
5. **Protection.** "Per-client rate limits; `429` with `Retry-After`."

Interviewers probe: *What if the client retries while the first call is still running?* (Lock on the key; return `409`.) *Why not offset?* (Deep-page cost, skips under writes.) *How do you deprecate v1?* (Usage metrics per version, sunset dates, migration guides.) *REST or gRPC?* (Public clients get REST/JSON; internal hot paths may use gRPC.)

## Check yourself

> [!question]- Why does AIP-158 call adding pagination to an existing list method a breaking change?
> Old clients assume one response holds the whole collection. Once the server starts returning a first page plus a token they ignore, they silently lose data.

> [!question]- A client sends the same Idempotency-Key twice, one second apart, while the first request is still processing. What should happen?
> The second request must not execute. Per the IETF draft, the server should answer `409 Conflict`. Once the first finishes, later retries replay its stored response.

> [!question]- Is adding a new value to a response enum backwards-compatible?
> On the wire, yes, but older clients with exhaustive switches may break. AIP-180 says APIs should document that new response enum values may appear.

## Further reading

- 📝 [APIs as infrastructure: future-proofing Stripe with versioning](https://stripe.com/blog/api-versioning) — how dated versions and change modules work in production.
- 📝 [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) — failure cases, idempotency keys, backoff and jitter.
- 📝 [Evolving API Pagination at Slack](https://slack.engineering/evolving-api-pagination-at-slack/) — offset vs cursor, with real migration trade-offs.
- 📄 [AIP-180: Backwards compatibility](https://google.aip.dev/180) — the clearest list of what counts as a breaking change.
- 📄 [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header) — the emerging standard for retry-safe POSTs.

## Related

- [[REST (Deep Dive)]] — HTTP method semantics, status codes and HATEOAS.
- [[gRPC (Deep Dive)]] — schema evolution with protobuf field numbers.
- [[Rate Limiting (Deep Dive)]] — protecting the API surface.
- [[Fault Tolerance (Deep Dive)]] — retries, timeouts and backoff across services.
- [[AI Agents & Tool Use (Deep Dive)]] — tool definitions are API contracts an LLM must follow.

> [!nav] Keep going
> ← [[Sharding (Deep Dive)|Sharding]] · [[Communication|💬 Communication]] · [[REST (Deep Dive)|REST]] →
> 🌱 Back to the basics: [[API Design]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [What is an API?](https://aws.amazon.com/what-is/api/) — Amazon Web Services. Official docs. Checked 2026-11.
[^2]: 📄 [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) — OpenAPI Initiative. Standard. Checked 2026-11.
[^3]: 📄 [Web API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design) — Microsoft Azure Architecture Center. Official docs. Checked 2026-11.
[^4]: 📄 [AIP-180: Backwards compatibility](https://google.aip.dev/180) — Google API Improvement Proposals. Official docs. Checked 2026-11.
[^5]: 📝 [APIs as infrastructure: future-proofing Stripe with versioning](https://stripe.com/blog/api-versioning) — Brandur Leach, Stripe, 2017. Engineering blog. Checked 2026-11.
[^6]: 📄 [Getting started with the REST API](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api) — GitHub Docs. Official docs. Checked 2026-11.
[^7]: 📝 [Evolving API Pagination at Slack](https://slack.engineering/evolving-api-pagination-at-slack/) — Michael Hahn, Slack Engineering, 2017. Engineering blog. Checked 2026-11.
[^8]: 📄 [AIP-158: Pagination](https://google.aip.dev/158) — Google API Improvement Proposals. Official docs. Checked 2026-11.
[^9]: 📄 [RFC 9110: HTTP Semantics, section 9.2](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Standard. Checked 2026-11.
[^10]: 📝 [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) — Brandur Leach, Stripe, 2017. Engineering blog. Checked 2026-11.
[^11]: 📄 [Idempotent requests](https://docs.stripe.com/api/idempotent_requests) — Stripe documentation. Official docs. Checked 2026-11.
[^12]: 📄 [The Idempotency-Key HTTP Header Field (draft-ietf-httpapi-idempotency-key-header-08)](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header) — Jena, Dalal and Tishkin, IETF HTTPAPI working group. Internet-Draft. Checked 2026-11.
