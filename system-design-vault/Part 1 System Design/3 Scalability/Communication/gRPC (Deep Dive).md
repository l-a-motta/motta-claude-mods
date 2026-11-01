---
aliases: [gRPC deep dive]
tags: [level/deep-dive, part/1, section/scalability, branch/communication]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Communication]]"
basics: "[[gRPC]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Scalability]] › [[Communication]] › [[gRPC]] › 🔬 Deep Dive

> [!tldr] For engineers
> gRPC is an RPC framework: a `.proto` contract generates typed stubs, messages are **protobuf-encoded and length-prefixed**, and each call is **one HTTP/2 stream** with status carried in trailers. You get four call shapes (unary plus three streaming), deadlines, cancellation and metadata out of the box. The operational catches: **no deadline by default**, **connection-level load balancers pin all traffic to one backend**, and browsers need gRPC-Web through a proxy.

> [!basics]- New to this? Start with the basics
> [[gRPC]] explains it with no jargon.

## How it really works

### Contract first

You describe services and messages in a `.proto` file and run `protoc` with the gRPC plugin to generate client stubs and server interfaces in each language.[^1] The project recommends proto3.[^1]

```protobuf
syntax = "proto3";
service RouteGuide {
  rpc GetFeature(Point) returns (Feature);                // unary
  rpc ListFeatures(Rectangle) returns (stream Feature);   // server streaming
  rpc RecordRoute(stream Point) returns (RouteSummary);   // client streaming
  rpc RouteChat(stream RouteNote) returns (stream RouteNote); // bidirectional
}
message Point { int32 latitude = 1; int32 longitude = 2; }
```

Those four shapes are the whole call model: unary, server streaming, client streaming, and bidirectional streaming, where both sides read and write independently.[^2] gRPC's 2015 design principles explain the stance: **services, not objects; messages, not references**, to avoid the pitfalls of distributed objects.[^3]

### The wire format: protobuf

Protobuf is a "language-neutral, platform-neutral extensible mechanism for serializing structured data".[^4] Each field is written as a **tag** plus a value, where `tag = (field_number << 3) | wire_type`.[^5] Integers use **varints**: 7 payload bits per byte plus a continuation bit, 1 to 10 bytes per value.[^5] Field `a = 1` set to 150 encodes as three bytes, `08 96 01`.[^5] Field names never go on the wire; the decoder needs the `.proto` to interpret them.[^5]

That design drives the evolution rules. Old code skips unknown new fields (forward compatibility) and new code reads old messages (backward compatibility).[^4] But field numbers **can never be reused**, so deleted ones should be marked `reserved`.[^4] Google's AIP-180 adds the API-level rules: no type changes, no moving fields into or out of a `oneof`, no new required fields within a major version.[^6]

Protobuf is not self-describing, not compressed, and assumes a message fits in memory; beyond a few megabytes, use another format or chunk with streaming.[^4]

### Transport: HTTP/2

Each RPC is an ordinary HTTP/2 stream, and each message rides in HTTP/2 DATA frames; one frame can hold several small messages, or one large message can span frames.[^7] A **channel** is a virtual connection to an endpoint and may be backed by several HTTP/2 connections, so many concurrent RPCs share them.[^7]

On the wire a call looks like this:[^8]

```http
:method: POST
:path: /routeguide.RouteGuide/GetFeature
content-type: application/grpc
te: trailers
grpc-timeout: 200m

[0x00][00 00 00 0A][10 bytes of protobuf]     ← 1-byte compressed flag, 4-byte big-endian length

trailers:  grpc-status: 0   grpc-message: …
```

Status always travels in **trailers**, even on success; a call that fails before sending anything may use a **Trailers-Only** response.[^8] `te: trailers` exists to detect proxies that would break this.[^8]

### Lifecycle: deadlines, cancellation, metadata

- **Deadlines.** By default gRPC sets **no deadline**, so a client can wait "effectively forever".[^9] When a deadline passes, the client fails with `DEADLINE_EXCEEDED` and the server's call is cancelled with `CANCELLED`, but your handler must notice and stop its own work.[^9]
- **Propagation.** A server that calls downstream services can forward the deadline. gRPC sends it as a remaining *timeout* with elapsed time already subtracted, which sidesteps clock skew; Java and Go propagate automatically, C++ needs opting in.[^9]
- **Cancellation.** Either side can cancel at any time, and changes made before cancellation are **not rolled back**.[^2]
- **Independent outcomes.** Client and server each decide locally whether a call succeeded, so they can disagree (the server finished, the client saw a timeout).[^2] Mutating RPCs therefore still need idempotency (see [[API Design (Deep Dive)]]).
- **Metadata.** Key-value pairs such as auth tokens or trace IDs ride outside the message; the `grpc-` prefix is reserved.[^2]

### Load balancing

HTTP/2 multiplexes all requests over one long-lived TCP connection, so with a connection-level (L4) balancer such as a default Kubernetes Service, "all requests will get pinned to a single destination pod".[^10] Three fixes:[^10][^11]

- **Proxy (L7) balancing:** an HTTP/2-aware proxy or service-mesh sidecar spreads streams across backends. Simple clients, but the proxy sits in the data path.
- **Client-side balancing:** the client resolves many backends (e.g. a Kubernetes headless Service returning multiple DNS records) and picks one per RPC. No extra hop, but needs a capable, trusted client.
- **Lookaside balancing:** a separate LB service tells clients which backends to use; gRPC defines a protocol for it.[^11]

### Browsers: gRPC-Web

No browser API offers enough control over HTTP/2 to speak native gRPC, and raw frames and trailers are inaccessible.[^12] gRPC-Web moves trailers into the body and needs a **mandatory translating proxy** such as Envoy.[^12] As of the project's 2019 write-up, it supports unary and server-streaming calls; client and bidirectional streaming are not mandated by the spec and wait on browser streaming APIs.[^12]

## Design choices and trade-offs

| Dimension | gRPC + protobuf | REST + JSON |
| --- | --- | --- |
| Contract | Required `.proto`, codegen in each language | Optional (OpenAPI); often hand-written clients |
| Payload | Binary, small, not human-readable | Text, larger, readable with curl |
| Streaming | Four native call shapes | Request/response; push needs SSE or WebSockets |
| Browser support | Only via gRPC-Web plus a proxy | Native |
| HTTP caching | Effectively none (all calls are POST) | GET responses cacheable by CDNs and browsers |
| Load balancing | Needs L7 or client-side LB | Works with plain L4 |
| Evolution | Field numbers; strict, tool-checkable | Additive JSON fields; conventions only |
| Best fit | Internal service-to-service, polyglot, high volume | Public APIs, web clients, third-party developers |

| LB option | Gains | Costs |
| --- | --- | --- |
| L4 only | Zero config | One backend per connection; hot spots |
| L7 proxy / mesh | Per-request balancing, any client | Extra hop and component |
| Client-side | No extra hop | Smarter clients; trust boundary |
| Lookaside | Central policy, simple clients | Another service to run |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Officially supported client-library languages | 11[^13] |
| Stubby (gRPC's predecessor) in use at Google | Over a decade before gRPC; open-sourcing decided March 2015[^13] |
| Varint size | 1–10 bytes; 150 encodes in 2 bytes plus a 1-byte tag[^5] |
| gRPC message prefix | 5 bytes: 1-byte compressed flag + 4-byte length[^8] |
| `grpc-timeout` value | Up to 8 digits plus a unit (H, M, S, m, u, n)[^8] |
| HTTP/2 frame size used in gRPC's example | 16 KB default[^7] |
| Dropbox RPC scale on gRPC (2019) | Hundreds of services, millions of requests/s[^14] |
| Dropbox example default deadlines | 1,000 ms per service, 5,000 ms per method[^14] |
| Dropbox TLS handshake signing, ECDSA P-256 vs RSA 2048 | 40,410.9 vs 1,527.9 ops/s[^14] |

## Failure modes

- **Hung callers.** No deadline means a slow dependency ties up threads and connections indefinitely. Dropbox made deadlines mandatory and propagated them across services.[^14][^9]
- **Zombie work.** The client gave up, but the server keeps computing. Check for cancellation in long handlers.[^9]
- **Hot backend.** L4 load balancing pins every RPC from a client to one pod; new pods get no traffic until clients reconnect. Use L7 or client-side balancing.[^10]
- **Schema breakage.** Reusing a deleted field number makes old data decode as the wrong field. Reserve retired numbers.[^4]
- **Oversized messages.** Multi-megabyte protobufs strain memory; stream chunks instead.[^4]
- **Proxies that drop trailers.** Status is lost and calls look broken; `te: trailers` helps detect such intermediaries.[^8]
- **Retry ambiguity.** A timed-out call may have succeeded on the server; retry only idempotent methods or use request IDs.[^2]

## In the real world

- **Google** ran Stubby internally for over a decade and rebuilt it in the open as gRPC.[^13]
- **Dropbox** built Courier on gRPC: mutual TLS everywhere, per-method ACLs and rate limits, automatic per-method stats and tracing, mandatory deadlines, and LIFO-queue load shedding.[^14]
- **Square, Netflix, Cockroach Labs, Cisco and Juniper** are listed as adopters on the project site.[^13]
- **Envoy** ships the gRPC-Web filter used by Google's browser client; **Linkerd** sidecars do per-request gRPC balancing in Kubernetes.[^12][^10]

## In a design interview

Use gRPC for the internal hot path and say why:

1. "Mobile and web clients hit a REST/JSON gateway; behind it, services talk gRPC."
2. "Contracts live in a shared proto repo; CI blocks field-number reuse and type changes."
3. "Every call sets a deadline, propagated downstream; 300 ms budget for the checkout path."
4. "Client-side round-robin via headless DNS, or a mesh sidecar, because L4 pins HTTP/2 connections."
5. "Server streaming for the live order feed instead of polling."

Probes: *Why not REST internally?* (Payload size, codegen, streaming.) *How do you debug binary traffic?* (Reflection-aware tools, logging decoded messages.) *What happens when a downstream times out?* (`DEADLINE_EXCEEDED` propagates; caller falls back or fails fast.)

## Check yourself

> [!question]- Why does a default Kubernetes Service balance HTTP/1.1 traffic tolerably but not gRPC?
> HTTP/1.1 clients open several connections that expire, so requests spread over time. gRPC multiplexes everything over one long-lived HTTP/2 connection, so connection-level balancing picks one pod and never revisits the choice.

> [!question]- gRPC propagates deadlines as a remaining timeout, not an absolute timestamp. Why?
> Servers' clocks differ. Sending "200 ms left" after subtracting elapsed time avoids clock-skew errors that an absolute deadline would suffer.

> [!question]- You delete protobuf field 4 and later add a new field reusing number 4 with a different type. What breaks?
> Old messages or old clients still carrying field 4 get decoded as the new field, corrupting data or failing to parse. Mark 4 as `reserved` instead.

## Further reading

- 📄 [Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/) — call types, deadlines, cancellation and metadata in one page.
- 📄 [gRPC over HTTP/2 protocol spec](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md) — the exact headers, framing and trailers.
- 📄 [Protocol Buffers encoding](https://protobuf.dev/programming-guides/encoding/) — how varints and tags actually look on the wire.
- 📝 [gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/) — the L4 pinning problem, explained clearly.
- 📝 [Courier: Dropbox migration to gRPC](https://dropbox.tech/infrastructure/courier-dropbox-migration-to-grpc) — a full production migration with real numbers.

## Related

- [[REST (Deep Dive)]] — the resource-oriented alternative.
- [[API Design (Deep Dive)]] — compatibility rules and idempotency for any API.
- [[Load Balancing (Deep Dive)]] — L4 vs L7 balancing in depth.
- [[Microservices (Deep Dive)]] — where gRPC's contracts pay off.
- [[Distributed Tracing (Deep Dive)]] — trace IDs travel in gRPC metadata.
- [[Deployment & Serving (Deep Dive)]] — internal calls between model servers and the services around them.

> [!nav] Keep going
> ← [[REST (Deep Dive)|REST]] · [[Communication|💬 Communication]] · [[WebSockets (Deep Dive)|WebSockets]] →
> 🌱 Back to the basics: [[gRPC]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Introduction to gRPC](https://grpc.io/docs/what-is-grpc/introduction/) — gRPC Authors. Official docs. Checked 2026-11.
[^2]: 📄 [Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/) — gRPC Authors. Official docs. Checked 2026-11.
[^3]: 📝 [gRPC Motivation and Design Principles](https://grpc.io/blog/principles/) — Louis Ryan, gRPC blog, 2015. Engineering blog. Checked 2026-11.
[^4]: 📄 [Overview](https://protobuf.dev/overview/) — Protocol Buffers documentation, Google. Official docs. Checked 2026-11.
[^5]: 📄 [Encoding](https://protobuf.dev/programming-guides/encoding/) — Protocol Buffers documentation, Google. Official docs. Checked 2026-11.
[^6]: 📄 [AIP-180: Backwards compatibility](https://google.aip.dev/180) — Google API Improvement Proposals. Official docs. Checked 2026-11.
[^7]: 📝 [gRPC on HTTP/2: Engineering a Robust, High-performance Protocol](https://grpc.io/blog/grpc-on-http2/) — Jean de Klerk, gRPC blog, 2018. Engineering blog. Checked 2026-11.
[^8]: 📄 [gRPC over HTTP2](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md) — gRPC project, GitHub. Official spec. Checked 2026-11.
[^9]: 📄 [Deadlines](https://grpc.io/docs/guides/deadlines/) — gRPC Authors. Official docs. Checked 2026-11.
[^10]: 📝 [gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/) — William Morgan (Buoyant), Kubernetes blog, 2018. Article. Checked 2026-11.
[^11]: 📝 [gRPC Load Balancing](https://grpc.io/blog/grpc-load-balancing/) — gRPC blog, 2017. Engineering blog. Checked 2026-11.
[^12]: 📝 [The state of gRPC in the browser](https://grpc.io/blog/state-of-grpc-web/) — Johan Brandhorst, gRPC blog, 2019. Engineering blog. Checked 2026-11.
[^13]: 📄 [About gRPC](https://grpc.io/about/) — gRPC Authors. Official docs. Checked 2026-11.
[^14]: 📝 [Courier: Dropbox migration to gRPC](https://dropbox.tech/infrastructure/courier-dropbox-migration-to-grpc) — Ruslan Nigmatullin and Alexey Ivanov, Dropbox, 2019. Engineering blog. Checked 2026-11.
