---
aliases: [Encryption deep dive]
tags: [level/deep-dive, part/1, section/production, branch/security]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Security]]"
basics: "[[Encryption]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Security]] › [[Encryption]] › 🔬 Deep Dive

> [!tldr] For engineers
> Production encryption is **hybrid**: asymmetric cryptography authenticates peers and agrees on keys, and an AEAD cipher such as AES-GCM protects the bulk data. In transit that means TLS 1.3 with ephemeral key exchange; at rest it means envelope encryption, with data keys wrapped by a root key that never leaves an HSM. The math rarely fails; key management, nonce handling, implementation bugs and the coming quantum transition are where systems break.

> [!basics]- New to this? Start with the basics
> [[Encryption]] explains it with no jargon.

## How it really works

### The building blocks

- **Symmetric ciphers.** AES is a 128-bit block cipher with 128-, 192- or 256-bit keys, standardized as FIPS 197 in 2001 (editorially updated in 2023).[^1] A block cipher needs a **mode**. OWASP's guidance: AES with at least 128-bit (ideally 256-bit) keys, an **authenticated** mode such as GCM or CCM wherever available, and never ECB outside narrow cases.[^2]
- **Asymmetric cryptography.** Key pairs where one key undoes the other. It is much slower than symmetric crypto and can only encrypt messages about as large as its key, so real systems use it to protect a symmetric key, not the data.[^3]
- **Hashes and MACs.** A hash is a one-way function, which is why passwords are hashed with slow, salted algorithms rather than encrypted.[^4] A MAC (or the tag inside an AEAD cipher) proves integrity: the data came from a key holder and was not altered.[^5]
- **Randomness.** Keys, IVs and tokens must come from a cryptographically secure generator; ordinary PRNGs "must not be used for anything security critical."[^2]

### In transit: TLS 1.3

TLS has two layers: a **handshake** that authenticates the server (and optionally the client) and derives shared keys, and a **record protocol** that splits traffic into independently protected records.[^6] Version 1.3 (RFC 8446, August 2018) made three structural changes:[^6]

1. **Static RSA and static Diffie-Hellman are gone**, so every public-key key exchange is ephemeral and provides **forward secrecy**: stealing the server's long-term key later does not decrypt recorded sessions.
2. **Everything after ServerHello is encrypted**, including the certificate.
3. **Only AEAD ciphers remain**, such as AES-GCM: encryption and integrity in one primitive.

The handshake also dropped from two round trips to one, and resumed sessions can send **0-RTT** data in the first flight.[^7] 0-RTT data has no replay protection across connections, so servers should accept it only for requests that are safe to repeat.[^6]

Authentication rides on **certificates**: a CA signs a binding between a domain and a public key. Let's Encrypt made this free and automated, with every issued certificate publicly logged.[^8] Browsers enforce HTTPS-only for a domain through **HSTS**:[^9]

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

HSTS only protects after the first secure visit, which is why domains are **preloaded** into browsers; preload requires `max-age` of at least one year and `includeSubDomains`.[^9]

### At rest: envelope encryption

Encrypting a petabyte with one key is unmanageable: rotation would mean re-encrypting everything, and the key would sit in every server's memory. **Envelope encryption** fixes this. A per-object **data encryption key (DEK)** encrypts the data, and a **key encryption key (KEK)** encrypts the DEK; the wrapped DEK is stored beside the ciphertext.[^5]

```python
# Encrypt
resp = kms.generate_data_key(KeyId="alias/orders", KeySpec="AES_256")
ciphertext = aes_gcm_encrypt(resp["Plaintext"], data, aad=object_id)
store(object_id, ciphertext, wrapped_key=resp["CiphertextBlob"])
wipe(resp["Plaintext"])                  # plaintext DEK never persisted

# Decrypt
dek = kms.decrypt(CiphertextBlob=wrapped_key)["Plaintext"]   # authorized + audited call
data = aes_gcm_decrypt(dek, ciphertext, aad=object_id)
```

In AWS KMS the root keys never leave FIPS 140-3 Security Level 3 HSMs unencrypted, and all symmetric operations inside them use AES-GCM with 256-bit keys.[^5] Rotating a KEK means re-wrapping small DEKs, not re-encrypting the data.[^5] Google Cloud goes further by default: storage is split into chunks, **each chunk gets its own DEK**, DEKs are wrapped by KEKs in an internal Keystore, and Keystore's own key is protected by a root keystore.[^10]

Where to encrypt depends on the threat model: disk or filesystem encryption protects against stolen media; database or application-level (field) encryption also protects against someone with database access.[^2] Keys belong in a KMS, vault or HSM, never in source code and preferably not in environment variables.[^2]

### Post-quantum key exchange

A large quantum computer would break today's public-key algorithms. The near-term risk is **harvest now, decrypt later**: traffic recorded today can be decrypted after "Q-day."[^11] NIST finalized its first post-quantum standards on August 13, 2024, with **FIPS 203 (ML-KEM)** as the primary key-encapsulation standard.[^12] Browsers and CDNs deploy the hybrid **X25519MLKEM768**, which stays secure unless both the classical and the lattice-based halves fall.[^11] Signatures lag: as of late 2025 not a single public post-quantum certificate was in use, and broad browser trust was not expected before 2027.[^11]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Provider-managed keys (default at-rest) | Zero effort; on by default | Provider controls keys; coarse audit |
| Customer-managed KMS keys | Own rotation, access policy, audit log, revocation | Per-call cost and quotas; you can lock yourself out |
| Client-side / application-level encryption | Protects against provider and DBA access | No server-side search or indexing; key distribution is yours |
| TLS terminated at the load balancer | Offloads crypto; L7 routing and caching | Plaintext inside the network unless re-encrypted |
| End-to-end TLS / mTLS between services | Encrypted and authenticated hop by hop | Certificate issuance and rotation for every workload |
| AES-GCM | Fast with hardware AES; integrity built in | Catastrophic on nonce reuse under one key |
| Hybrid post-quantum key exchange | Defends recorded traffic against future decryption | Larger handshakes; origin support still thin |

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| AES block size / key sizes | 128 bits / 128, 192, 256 bits[^1] |
| TLS 1.2 → TLS 1.3 full-handshake round trips | 2 → 1[^7] |
| Chrome page loads over HTTPS | ~30–45% (2015) → ~95–99% (2020 onward)[^13] |
| HSTS preload minimum `max-age` | 31,536,000 s (one year)[^9] |
| HTTPS servers found repeating AES-GCM nonces (2016 scan) | 184; over 70,000 more used random nonces[^14] |
| Human traffic to Cloudflare using post-quantum key agreement (late Oct 2025) | Over 50%[^11] |
| Origins supporting X25519MLKEM768 at the same time | 3.7%[^11] |
| Extra TLS handshake size if certificates switch to ML-DSA-44 | About 15 kB[^11] |
| New S3 objects encrypted by default since Jan 5, 2023 | All, with AES-256[^15] |

## Failure modes

- **Nonce reuse in GCM.** Two messages under the same key and nonce leak the authentication key and allow forgeries. A 2016 Internet-wide scan found 184 HTTPS servers doing exactly this, including financial institutions and a credit card company.[^14] Use counter-based nonces or a misuse-resistant mode, and rotate keys long before nonces run out.
- **Implementation bugs.** Heartbleed (CVE-2014-0160) was an OpenSSL programming mistake, not a protocol flaw, that let anyone read server memory, including private keys.[^16] Recovery meant patching, revoking and reissuing certificates, and resetting sessions and passwords; forward secrecy limited exposure of past traffic.[^16]
- **Downgrade and stripping.** One plain-HTTP navigation lets an on-path attacker redirect the user.[^13] HSTS and preload close the gap.[^9]
- **Keys next to data.** Hard-coded keys, keys in the same database, or keys in environment variables that leak through diagnostics.[^2]
- **Unauthenticated modes.** CBC or CTR without a MAC, or ECB at all, invite tampering and pattern leaks.[^2]
- **Forgotten old data.** Turning on default encryption does not encrypt existing objects; S3 needs a batch copy for that.[^15]
- **Harvest now, decrypt later.** Long-lived secrets sent today over classical key exchange may be readable later.[^11]

## In the real world

- **Google Cloud** encrypts all customer content at rest by default with AES-256, per-chunk DEKs and automatic KEK rotation, using its FIPS 140-2 validated BoringCrypto module.[^10]
- **AWS** applies SSE-S3 to every new S3 object and offers KMS for customer-managed envelope encryption.[^15][^5]
- **Chrome** announced it would enable "Always Use Secure Connections" for public sites by default in Chrome 154, scheduled for October 2026.[^13]
- **Cloudflare** reported in October 2025 that most human traffic it serves already uses post-quantum key agreement, driven mainly by browser and OS updates such as Apple's iOS 26.[^11]

## In a design interview

Cover both states of data and say who holds the keys:

1. **In transit:** "TLS 1.3 at the edge with HSTS; mTLS between services, certificates issued and rotated automatically."
2. **At rest:** "Storage encryption on by default; sensitive columns encrypted in the app with envelope encryption under a KMS key per tenant."
3. **Keys:** "Root keys in KMS/HSM, access policies plus audit logs, scheduled KEK rotation; DEKs never stored in plaintext."
4. **Passwords:** "Hashed with Argon2id, never encrypted."

Probes: *What if the KMS is down?* (Cache unwrapped DEKs briefly in memory; decryption availability equals KMS availability.) *How do you delete a user's data from backups?* (Crypto-shredding: destroy their key.) *What changes for post-quantum?* (Hybrid key exchange now; signatures later.)

## Check yourself

> [!question]- Why does removing static RSA key exchange give TLS 1.3 forward secrecy?
> With static RSA the client encrypts the session secret under the server's long-term key, so anyone who later steals that key can decrypt recorded traffic. Ephemeral Diffie-Hellman derives a fresh secret per connection and discards it, so a later key theft reveals nothing about past sessions.

> [!question]- Why encrypt data with a DEK and wrap it, instead of calling KMS on the data directly?
> KMS calls are remote, rate-limited and size-limited. A local DEK encrypts any amount of data at memory speed, only the small DEK goes to KMS, and rotating the KEK re-wraps keys without touching the data.

> [!question]- A service generates AES-GCM nonces randomly for a long-lived key. What is the risk?
> With enough messages, two random nonces eventually collide under the same key, which breaks GCM's integrity. Use deterministic counters, rotate keys well before the collision bound, or use a nonce-misuse-resistant mode.

## Further reading

- 📄 [RFC 8446: TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446) — the specification, with a readable overview of what changed from 1.2.
- 📝 [A Detailed Look at RFC 8446 (a.k.a. TLS 1.3)](https://blog.cloudflare.com/rfc-8446-aka-tls-1-3/) — Cloudflare's walkthrough of the handshake and why RSA key exchange went away.
- 📄 [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) — algorithm, mode and key-management rules in one page.
- 📄 [AWS KMS cryptography essentials](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html) — envelope encryption and HSM-backed keys explained by the vendor.
- 📝 [State of the post-quantum Internet in 2025](https://blog.cloudflare.com/pq-2025/) — where the quantum migration actually stands.

## Related

- [[Authentication (Deep Dive)]] — password hashing and token signing build on the same primitives.
- [[Authorization (Deep Dive)]] — KMS key policies are access control for decryption.
- [[Networking (Deep Dive)]] — where TLS sits in the protocol stack.
- [[Load Balancing (Deep Dive)]] — TLS termination and re-encryption.
- [[Object Storage (Deep Dive)]] — server-side and client-side encryption options.
- [[AI Security & Privacy (Deep Dive)]] — protecting training data, embeddings and prompts.

> [!nav] Keep going
> ← [[Authorization (Deep Dive)|Authorization]] · [[Security|🔒 Security]] · [[Logging (Deep Dive)|Logging]] →
> 🌱 Back to the basics: [[Encryption]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [FIPS 197: Advanced Encryption Standard (AES)](https://csrc.nist.gov/pubs/fips/197/final) — NIST. Official docs. Checked 2026-11.
[^2]: 📄 [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^3]: 📄 [Public-key cryptography](https://developer.mozilla.org/en-US/docs/Glossary/Public-key_cryptography) — MDN Web Docs. Official docs. Checked 2026-11.
[^4]: 📄 [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^5]: 📄 [AWS KMS cryptography essentials](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html) — AWS Key Management Service Developer Guide. Official docs. Checked 2026-11.
[^6]: 📄 [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://datatracker.ietf.org/doc/html/rfc8446) — IETF, August 2018. Official docs. Checked 2026-11.
[^7]: 📝 [A Detailed Look at RFC 8446 (a.k.a. TLS 1.3)](https://blog.cloudflare.com/rfc-8446-aka-tls-1-3/) — Cloudflare Blog, August 2018. Article. Checked 2026-11.
[^8]: 📄 [About Let's Encrypt](https://letsencrypt.org/about/) — Let's Encrypt (ISRG). Official docs. Checked 2026-11.
[^9]: 📄 [Strict-Transport-Security header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security) — MDN Web Docs. Official docs. Checked 2026-11.
[^10]: 📄 [Default encryption at rest](https://docs.cloud.google.com/docs/security/encryption/default-encryption) — Google Cloud documentation. Official docs. Checked 2026-11.
[^11]: 📝 [State of the post-quantum Internet in 2025](https://blog.cloudflare.com/pq-2025/) — Cloudflare Blog, October 2025. Article. Checked 2026-11.
[^12]: 📄 [NIST Releases First 3 Finalized Post-Quantum Encryption Standards](https://www.nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards) — NIST, August 2024. Official docs. Checked 2026-11.
[^13]: 📝 [HTTPS by default](https://blog.google/security/https-by-defau/) — Google Chrome Security Team, October 2025. Article. Checked 2026-11.
[^14]: 🔬 [Nonce-Disrespecting Adversaries: Practical Forgery Attacks on GCM in TLS](https://www.blackhat.com/docs/us-16/materials/us-16-Devlin-Nonce-Disrespecting-Adversaries-Practical-Forgery-Attacks-On-GCM-In-TLS-wp.pdf) — Böck, Zauner, Devlin, Somorovsky and Jovanovic, 2016. Paper. Checked 2026-11.
[^15]: 📄 [Default encryption FAQ](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html) — Amazon S3 User Guide. Official docs. Checked 2026-11.
[^16]: 📝 [The Heartbleed Bug](https://heartbleed.com/) — heartbleed.com. Article. Checked 2026-11.
