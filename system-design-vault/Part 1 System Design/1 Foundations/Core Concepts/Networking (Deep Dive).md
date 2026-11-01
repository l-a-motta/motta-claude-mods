---
aliases: [Networking deep dive]
tags: [level/deep-dive, part/1, section/foundations, branch/core-concepts]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Foundations]]"
branch: "[[Core Concepts]]"
basics: "[[Networking]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Foundations]] › [[Core Concepts]] › [[Networking]] › 🔬 Deep Dive

> [!tldr] For engineers
> Every remote call pays for **name resolution, connection setup and round trips**, and round trips are bounded by distance, not bandwidth. TCP buys a reliable, ordered byte stream at the cost of handshake latency and transport-level head-of-line blocking. QUIC moves the transport into user space over UDP, merges the transport and crypto handshakes, and makes loss recovery per stream; HTTP/3 runs on it. Good designs minimize round trips and reuse connections.

> [!basics]- New to this? Start with the basics
> [[Networking]] explains it with no jargon.

## How it really works

### The layers that actually ship

The Internet protocol suite has four layers: link, internet (IP), transport (TCP, UDP) and application (HTTP, DNS, SMTP).[^1] The seven-layer OSI model, published by ISO in 1984, was developed separately; TCP/IP is not based on it and maps onto it only roughly.[^2] In interviews, "L4" and "L7" load balancers borrow OSI numbering for transport and application.

### IP

IP carries datagrams from source host to destination host; it is connectionless and gives no delivery guarantees.[^1] IPv6 widened addresses from 32 to 128 bits and requires every link to carry packets of at least 1,280 octets.[^3]

### DNS

A **recursive resolver**, usually run by the ISP or the company network, walks the hierarchy for the client: a root server points to the TLD servers (for `.com`), which point to the domain's **authoritative** servers, which return the record.[^4] The resolver caches the answer for the record's **TTL**, a 32-bit count of seconds; a TTL of zero means "don't cache".[^5] Classic DNS runs on UDP and TCP port 53, and UDP messages are limited to 512 bytes; longer answers are truncated with the TC bit so the client retries over TCP.[^5] Modern resolvers use EDNS(0) to advertise a larger UDP payload size, so most answers fit without the TCP fallback.[^6]

### TCP

TCP provides a "reliable, in-order, byte-stream service".[^7] Connection setup is a three-way handshake: SYN carrying the client's initial sequence number, SYN-ACK acknowledging it and carrying the server's, then ACK.[^7] Every octet has a sequence number and acknowledgments are cumulative: ACK X means everything before X arrived.[^7] The receiver advertises a **window**, the bytes it will accept, for flow control, and congestion control is mandatory.[^7]

A new connection starts slowly. RFC 6928 raised the initial congestion window to 10 segments, at most 14,600 bytes, because most web transfers are short and finish during slow start.[^8]

```text
Fresh HTTPS over TCP + TLS     DNS  →  TCP handshake  →  TLS handshake  →  request
                               2–3 round trips before the first request byte
QUIC, first visit              DNS  →  combined handshake (1 RTT)  →  request
QUIC, repeat visit (0-RTT)     DNS  →  request sent with the first packet
```

### UDP

UDP sends datagrams "with a minimum of protocol mechanism": an 8-byte header with source port, destination port, length and checksum, and no delivery or duplicate protection.[^9] It is the base for DNS queries, real-time media and QUIC.

### TLS

TLS 1.3 always authenticates the server, optionally the client, and guarantees confidentiality and integrity of data after the handshake.[^10] It also allows **0-RTT early data** on resumed connections, with two caveats: "there are no guarantees of non-replay between connections", and early data is not forward secret.[^10]

### HTTP/1.1, HTTP/2 and HTTP/3

HTTP is a stateless request-response protocol; HTTP/1.0 opened a connection per request, HTTP/1.1 added persistent connections, and HTTP/2 multiplexes many messages over one connection in binary frames.[^11] Multiplexing over TCP has a catch: TCP loss recovery cannot see the streams, so "a lost or reordered packet causes all active transactions to experience a stall".[^12] Running HTTP/1.1 over several parallel connections dodges that but splits congestion control across connections.[^12]

QUIC fixes both. It provides "reliability at the stream level and congestion control across the entire connection", so one stream that suffers loss "does not prevent progress on other streams".[^12] QUIC packets are carried in UDP datagrams, and connection IDs let a connection survive a change of network path, such as Wi-Fi to cellular.[^13] Google built QUIC in user space over UDP so it could ship changes at application-release speed and pass through middleboxes, and encrypted it so middleboxes could not ossify it.[^14]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| TCP | Reliable, ordered, universally supported | Handshake latency; head-of-line blocking across multiplexed streams |
| UDP | No setup, no retransmission waits | Application must handle loss, order and congestion |
| QUIC / HTTP/3 | 0-RTT or 1-RTT setup; per-stream loss recovery; connection migration | More server CPU; some networks block UDP[^14] |
| HTTP/1.1, several connections | Simple; isolates loss per connection | More handshakes; uncoordinated congestion control[^12] |
| HTTP/2, one connection | One handshake for many requests | One lost packet stalls every stream[^12] |
| Long DNS TTL | Fewer lookups, less resolver load | Slow failover when an address changes |
| Short DNS TTL | Fast traffic shifting | More lookups on the request path |
| Connection reuse (keep-alive, pools) | Skips DNS, TCP and TLS on later requests[^15] | Idle connections hold memory and descriptors |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| IPv4 vs IPv6 address size | 32 vs 128 bits[^3] |
| IPv6 minimum link MTU | 1,280 octets[^3] |
| UDP header | 8 bytes[^9] |
| Classic DNS message over UDP (without EDNS(0)) | 512 bytes max[^5][^6] |
| TCP initial window (RFC 6928) | 10 segments, ≤ 14,600 bytes[^8] |
| TCP + TLS setup before the first request | 2–3 RTTs[^14] |
| QUIC handshakes completing in 0-RTT | ~88% desktop, 68% mobile app (Google, 2017)[^14] |
| Connections with min RTT above 150 ms / 300 ms | > 20% / 10% (Google, 2017)[^14] |
| QUIC effect on Google Search latency | −8.0% desktop, −3.6% mobile[^14] |
| QUIC effect on YouTube rebuffer rate | −18.0% desktop, −15.3% mobile[^14] |
| QUIC share of traffic (2017) | > 30% of Google egress, ~7% of the Internet[^14] |
| QUIC server CPU vs. TLS/TCP | ~3.5× at first, ~2× after optimization[^14] |
| Video clients unable to use QUIC (UDP blocked or MTU too small, 2016) | 4.4%[^14] |

One caution from the same paper: handshake latency was well under 20% of total Search and video latency, so eliminating it moved end-to-end metrics only a few percent, which was still worth doing at Google's scale.[^14]

## Failure modes

- **Head-of-line blocking.** One lost packet on an HTTP/2 connection stalls every stream on it; on lossy mobile links this dominates tail latency.[^12] HTTP/3 removes the transport-level coupling.
- **Cold connections.** Each new connection repeats DNS, TCP and TLS before useful work.[^15] Pool and reuse connections between services; pre-warm them on deploy.
- **DNS staleness.** Resolvers keep answering with the cached address until the TTL expires, so DNS-based failover is only as fast as your TTL.[^5]
- **0-RTT replay.** Early data can be replayed by an attacker.[^10] Accept it only for idempotent requests like `GET`.
- **Network changes on mobile.** Switching networks changes the client IP, which invalidated cached QUIC tokens and was a main reason mobile 0-RTT rates trailed desktop.[^14] QUIC connection IDs let the connection itself migrate.[^13]
- **Shipping a new transport.** Google disabled QUIC globally in December 2015 after finding a client bug that could send 0-RTT requests unencrypted, then restored it once fixed clients rolled out.[^14] A remote kill switch for protocol features paid for itself.

## In the real world

- **Google** deployed QUIC across its front-end servers, Chrome, the YouTube app and the Google Search app on Android, then took it to the IETF.[^14] The standard is RFC 9000, published in May 2021, and HTTP/3 (RFC 9114) runs on it.[^13][^12]
- **Amazon Route 53** is a typical authoritative DNS service in the resolver → root → TLD → authoritative chain.[^4]
- **RFC 6928**, written by Google engineers, raised TCP's initial window because short web transfers were spending their lives in slow start.[^8]

## In a design interview

Networking questions are usually latency questions in disguise. A strong answer counts round trips:

1. **Cold path:** "A first-time mobile user pays DNS plus 2–3 RTTs for TCP and TLS. At 150 ms RTT that's roughly half a second before the first byte, so terminate TLS at an edge close to the user."
2. **Warm path:** "Service-to-service calls reuse pooled connections, so each call is one RTT inside the data center."
3. **Protocol per traffic type:** "HTTP/2 or gRPC between services, HTTP/3 to mobile clients, UDP for live media where late data is useless."
4. **Failover:** "DNS TTL of 60 seconds, plus health-checked load balancers, because DNS alone fails over only as fast as caches expire."

Interviewers then probe: *Why not UDP everywhere?* (you'd rebuild reliability and congestion control), *what does HTTP/2 not fix?* (TCP head-of-line blocking), *how stale can DNS be?* (up to the TTL), *is 0-RTT safe?* (only for replay-safe requests).

## Check yourself

> [!question]- HTTP/2 multiplexes streams on one connection. Why can a single lost packet still slow every request on it?
> TCP delivers bytes strictly in order and knows nothing about streams. Until the lost segment is retransmitted, data for every stream behind it waits in the receive buffer.

> [!question]- Why does raising TCP's initial window help web pages more than large downloads?
> Most web responses are small and finish during slow start. Starting at 10 segments lets them complete in fewer round trips, while large transfers spend most of their time past slow start anyway.

> [!question]- You cut a record's DNS TTL from one day to 60 seconds to prepare for a migration. Why must you do it at least a day early?
> Resolvers that cached the old record keep its original one-day TTL. Only after those entries expire will clients pick up the shorter TTL.

## Further reading

- 🔬 [The QUIC Transport Protocol: Design and Internet-Scale Deployment](https://research.google/pubs/the-quic-transport-protocol-design-and-internet-scale-deployment/) — rare production data on how transport changes move user-facing metrics.
- 📄 [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html) — section 1 is the clearest short history of HTTP's transport problems.
- 📄 [Understanding latency](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Understanding_latency) — where the milliseconds go in a real page load.
- 📄 [What is DNS?](https://aws.amazon.com/route53/what-is-dns/) — a clear walk through recursive resolution.
- 📄 [RFC 6928: Increasing TCP's Initial Window](https://www.rfc-editor.org/rfc/rfc6928.html) — a short, data-driven case for one small constant.

## Related

- [[Load Balancing (Deep Dive)]] — L4 vs. L7 balancing and connection handling.
- [[CDN (Deep Dive)]] — terminating connections close to users to save round trips.
- [[gRPC (Deep Dive)]] — RPC on top of HTTP/2 streams.
- [[WebSockets (Deep Dive)]] — long-lived, bidirectional connections.
- [[Encryption (Deep Dive)]] — TLS in depth.
- [[Operating Systems (Deep Dive)]] — sockets, `epoll` and the kernel side of networking.
- [[Deployment & Serving (Deep Dive)]] — the same round-trip math applies to model-serving endpoints.

> [!nav] Keep going
> ← [[Operating Systems (Deep Dive)|Operating Systems]] · [[Core Concepts|🧠 Core Concepts]] · [[Databases (Deep Dive)|Databases]] →
> 🌱 Back to the basics: [[Networking]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [RFC 1122: Requirements for Internet Hosts](https://www.rfc-editor.org/rfc/rfc1122.html) — IETF, 1989, section 1.1.3. Standard. Checked 2026-11.
[^2]: 📖 [OSI model](https://en.wikipedia.org/wiki/OSI_model) — Wikipedia. Encyclopedia. Checked 2026-11.
[^3]: 📄 [RFC 8200: Internet Protocol, Version 6 (IPv6) Specification](https://www.rfc-editor.org/rfc/rfc8200.html) — IETF, 2017. Standard. Checked 2026-11.
[^4]: 📄 [What is DNS?](https://aws.amazon.com/route53/what-is-dns/) — Amazon Web Services. Official docs. Checked 2026-11.
[^5]: 📄 [RFC 1035: Domain Names, Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035.html) — IETF, 1987. Standard. Checked 2026-11.
[^6]: 📄 [RFC 6891: Extension Mechanisms for DNS (EDNS(0))](https://www.rfc-editor.org/rfc/rfc6891.html) — IETF, 2013. Standard. Checked 2026-11.
[^7]: 📄 [RFC 9293: Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293.html) — IETF, 2022. Standard. Checked 2026-11.
[^8]: 📄 [RFC 6928: Increasing TCP's Initial Window](https://www.rfc-editor.org/rfc/rfc6928.html) — Chu et al., IETF, 2013. Standard. Checked 2026-11.
[^9]: 📄 [RFC 768: User Datagram Protocol](https://www.rfc-editor.org/rfc/rfc768.html) — IETF, 1980. Standard. Checked 2026-11.
[^10]: 📄 [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) — IETF, 2018. Standard. Checked 2026-11.
[^11]: 📄 [Overview of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview) — MDN Web Docs. Official docs. Checked 2026-11.
[^12]: 📄 [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html) — IETF, 2022. Standard. Checked 2026-11.
[^13]: 📄 [RFC 9000: QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000.html) — IETF, 2021. Standard. Checked 2026-11.
[^14]: 🔬 [The QUIC Transport Protocol: Design and Internet-Scale Deployment (PDF)](https://courses.cs.washington.edu/courses/cse550/21au/papers/CSE550.quic.pdf) — Langley et al., ACM SIGCOMM 2017. Paper. Checked 2026-11.
[^15]: 📄 [Understanding latency](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Understanding_latency) — MDN Web Docs. Official docs. Checked 2026-11.
