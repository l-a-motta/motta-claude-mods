---
aliases: [Authentication deep dive]
tags: [level/deep-dive, part/1, section/production, branch/security]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Security]]"
basics: "[[Authentication]]"
reading_time: 9 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Security]] › [[Authentication]] › 🔬 Deep Dive

> [!tldr] For engineers
> Authentication binds a request to an identity. A production design has three parts: **verify a credential** (ideally phishing-resistant, never a plaintext password at rest), **mint a session or token** that stands in for that proof, and **federate** through OpenID Connect so one identity provider serves many apps. Most real breaches exploit the seams: reused passwords, phishable second factors, long-lived bearer tokens and weak account recovery.

> [!basics]- New to this? Start with the basics
> [[Authentication]] explains it with no jargon.

## How it really works

### Factors and assurance levels

NIST SP 800-63B (revision 4) is the reference most policies copy. It classifies authenticators as something you know, have or are, and treats a biometric only as an unlock for a physical authenticator, never as an authenticator by itself.[^1] It defines three **authenticator assurance levels**:[^1]

- **AAL1:** one factor is acceptable; verifiers should offer MFA.
- **AAL2:** two distinct factors, and the verifier **must offer at least one phishing-resistant option**.
- **AAL3:** a phishing-resistant cryptographic authenticator with a non-exportable private key. Syncable authenticators (such as passkeys synced through a cloud account) are not allowed here, because their keys are exportable.

**Phishing resistance** has a precise meaning: the protocol itself stops a fake site from obtaining a usable secret, through channel binding or verifier-name binding, without relying on the user noticing the fake.[^1] Typed one-time codes and out-of-band codes do not qualify. SMS and voice (PSTN) are "restricted" authenticators, and email must not be used as an out-of-band channel at all.[^1]

### Storing passwords

Passwords are hashed with a deliberately slow, salted function, never encrypted, so a database thief cannot reverse them.[^2] OWASP's current order of preference:[^2]

| Algorithm | Minimum setting | Note |
| --- | --- | --- |
| Argon2id | m = 19 MiB, t = 2, p = 1 | Preferred; memory-hard |
| scrypt | N = 2^17, r = 8, p = 1 | When Argon2id is unavailable |
| bcrypt | work factor ≥ 10 | Legacy; input capped at 72 bytes |
| PBKDF2-HMAC-SHA256 | 600,000 iterations | When FIPS-140 compliance is required |

A unique random **salt** per password defeats precomputed tables and hides shared passwords; an optional **pepper** kept outside the database (in a vault or HSM) protects hashes if only the database leaks.[^2]

### Sessions and tokens

After login the server issues a stand-in credential. Two families exist.

**Opaque server-side sessions.** A random ID maps to state on the server. OWASP requires at least 64 bits of entropy from a CSPRNG, a new ID after every privilege change (to block session fixation), and cookie flags that keep the ID away from scripts and plaintext HTTP:[^3]

```http
Set-Cookie: sid=9f2c…; Secure; HttpOnly; SameSite=Lax; Path=/
```

**Self-contained tokens (JWT).** A JSON Web Token is three base64url parts, `header.payload.signature`, carrying registered claims such as `iss`, `sub`, `aud`, `exp` and `jti`.[^4] Any service with the key can verify it without a lookup. The price: a signed JWT stays valid until `exp` unless verifiers check a denylist (keyed on `jti`), and its payload is readable by anyone, because signing is not encryption.[^5]

### Federation: OAuth 2.0 and OpenID Connect

**OAuth 2.0** is a delegation protocol: it lets a client get a scoped, time-limited **access token** instead of the user's password, across four roles (resource owner, client, authorization server, resource server).[^6] By itself it says nothing about who the user is. **OpenID Connect** adds that: "a simple identity layer on top of the OAuth 2.0 protocol," whose output is a signed **ID token** (a JWT) describing the authentication event.[^7]

The flow to use today is the **authorization code flow with PKCE**. RFC 9700 (January 2025) says the implicit grant should not be used, the password grant must not be used, public clients must use PKCE, and redirect URIs must match exactly.[^8] Google's implementation shows the steps:[^9]

1. Generate a random `state` (anti-CSRF) and `nonce`; redirect to the provider with `response_type=code` and `scope=openid email`.
2. On return, check `state`, then exchange the code at the token endpoint over a back channel.
3. Validate the ID token, then look up or create the local user and start a session.

```python
claims = jwt.decode(id_token, key=jwks.get_key(kid),       # keys from jwks_uri, cached
                    algorithms=["RS256"],                    # pin; never accept "none"
                    audience=CLIENT_ID, issuer="https://accounts.google.com")
assert claims["nonce"] == session.pop("nonce")
user = users.find_or_create(provider="google", subject=claims["sub"])   # key on sub, not email
```

The OIDC spec requires checking the signature, `iss`, `aud`, `exp` and `nonce`.[^7] Google adds: key users on `sub`, because an account's email can change.[^9]

### Passkeys (WebAuthn / FIDO2)

At registration the device creates a key pair per site and keeps the private key; at login it signs a server challenge. Because there is no shared secret, a breach of the server's credential table leaks nothing replayable, and a look-alike domain gets nothing usable.[^10] **Synced** passkeys recover from device loss; **device-bound** ones (hardware keys) give the highest assurance.[^10]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Server-side session | Instant revocation; tiny cookie | Shared session store; lookup per request |
| Stateless JWT access token | No lookup; works across services | Hard to revoke; keep lifetimes short |
| SMS or TOTP second factor | Universal, cheap | Phishable; SMS has SIM-swap risk |
| Passkeys / security keys | Phishing-resistant; nothing reusable to steal | Recovery and enrollment UX |
| Own password database | Full control | You own hashing, breach checks, recovery |
| External identity provider (OIDC) | MFA, SSO, anomaly detection for free | Vendor dependency; token validation done right |

A common hybrid: short-lived JWT access tokens between services, with refresh tokens that are rotated or sender-constrained, which RFC 9700 requires for public clients.[^8]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Minimum password length, single-factor | 15 characters[^1] |
| Minimum password length when used with MFA | 8 characters[^1] |
| Maximum length verifiers should accept | At least 64 characters[^1] |
| Consecutive failed attempts before disabling | No more than 100[^1] |
| Reauthentication at AAL2 | ≤ 24 h overall, ≤ 1 h idle[^1] |
| Reauthentication at AAL3 | ≤ 12 h overall, ≤ 15 min idle[^1] |
| Session ID entropy | ≥ 64 bits[^3] |
| HMAC secret for JWTs | ≥ 160 bits of entropy[^5] |
| Breaches starting with credential abuse (2025) | 22%[^11] |
| On-device prompt vs. targeted attacks (Google, 2019) | 90% blocked[^12] |

NIST also bans composition rules ("must contain a symbol") and periodic forced rotation, and requires checking new passwords against a blocklist of common and breached ones.[^1]

## Failure modes

- **Credential stuffing and spraying.** Leaked pairs from other sites are replayed at scale. Defend with breached-password screening, MFA, throttling per account rather than per IP, and CAPTCHA only as defense in depth.[^13]
- **Phishing of second factors.** A fake login page can collect a typed OTP as easily as a password; only channel or verifier-name binding (as in WebAuthn) stops this structurally.[^1]
- **User enumeration.** Different messages, status codes or response times for "no such user" and "wrong password" reveal valid accounts. Return one generic error and keep timing constant.[^13]
- **Lockout as denial of service.** Hard lockouts let attackers lock out victims; keep a reset path open.[^13]
- **Weak account recovery.** Recovery is a second login path. Google found that knowledge-based challenges, such as recalling a last sign-in location, could stop as little as 10% of phishing.[^12] Require re-authentication after recovery and never use security questions.[^13]
- **Token misuse.** Accepting `alg: none` or confusing an RSA public key with an HMAC secret lets attackers forge tokens; pin the algorithm.[^5] Keep session tokens in `HttpOnly` cookies so injected scripts cannot read them.[^3]
- **Session fixation.** Reusing a pre-login session ID after login hands the attacker an authenticated session; always regenerate.[^3]

## In the real world

- **Google**'s OpenID Connect docs require validating `iss`, `aud` and `exp`, caching signing keys from `jwks_uri`, and keying users on `sub`.[^9]
- **Google's 2019 study** (with NYU and UC San Diego) measured that users relying solely on security keys had zero targeted-phishing takeovers.[^12]
- **AWS** tells customers to federate human users through an identity provider with temporary credentials and to prefer passkeys and security keys for MFA.[^14]
- **Passkeys:** in a 2024 FIDO Alliance survey, 53% of people had enabled them on at least one account.[^10]

## In a design interview

Separate **identity verification** from **request authentication**, then name the protocol:

1. **Login:** "Users sign in through an OIDC provider with authorization code + PKCE; we validate the ID token and key accounts on `sub`."
2. **Credential policy:** "Passkeys first; password fallback hashed with Argon2id; breached-password checks; per-account throttling."
3. **Session:** "Browser gets an `HttpOnly; Secure; SameSite` session cookie; internal services receive a 5–15 minute signed access token."
4. **Revocation and recovery:** "Logout deletes the server session; refresh tokens rotate; recovery forces re-authentication."

Probes: *How do you revoke a JWT?* (Short `exp`, `jti` denylist, refresh rotation.) *Why not SMS?* (Phishable, SIM swap.) *OAuth vs OIDC?* (Delegation vs identity.) *Service-to-service?* (Workload identity or mTLS, not shared API keys.)

## Check yourself

> [!question]- Why is OAuth 2.0 alone not an authentication protocol?
> An access token says a client may call an API on someone's behalf; it is meant for the resource server and need not say who the user is or when they logged in. OpenID Connect adds a signed ID token, audience-restricted to the client, that does.

> [!question]- A team stores bcrypt hashes and wants to raise the minimum password length to 100 characters. What breaks?
> bcrypt reads at most 72 bytes in most implementations, so longer passwords are silently truncated. Either cap the length at 72 bytes or migrate to Argon2id.

> [!question]- Why does WebAuthn resist phishing when a TOTP code does not?
> The authenticator's signature is bound to the site's origin, so a proxy on a look-alike domain gets a signature it cannot replay against the real site. A TOTP code is just a string the user can be tricked into typing anywhere.

## Further reading

- 📄 [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) — the normative source for password rules, AALs and phishing resistance.
- 📄 [RFC 9700: OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/rfc9700) — what changed since OAuth 2.0 and why PKCE is mandatory.
- 📄 [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — ID token claims and the exact validation steps.
- 📄 [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — current hashing parameters, kept up to date.
- 📄 [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — cookie flags, timeouts and fixation, in one place.

## Related

- [[Authorization (Deep Dive)]] — what the authenticated identity is allowed to do.
- [[Encryption (Deep Dive)]] — TLS protects every credential and token in transit.
- [[Rate Limiting (Deep Dive)]] — throttling login endpoints against guessing.
- [[API Design (Deep Dive)]] — bearer tokens and how APIs accept them.
- [[Microservices (Deep Dive)]] — propagating identity between services.
- [[AI Agents & Tool Use (Deep Dive)]] — agents acting on a user's delegated credentials.

> [!nav] Keep going
> ← [[Rate Limiting (Deep Dive)|Rate Limiting]] · [[Security|🔒 Security]] · [[Authorization (Deep Dive)|Authorization]] →
> 🌱 Back to the basics: [[Authentication]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [NIST SP 800-63B: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html) — National Institute of Standards and Technology, SP 800-63-4. Official docs. Checked 2026-11.
[^2]: 📄 [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^3]: 📄 [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^4]: 📄 [RFC 7519: JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519) — IETF, May 2015. Official docs. Checked 2026-11.
[^5]: 📄 [JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^6]: 📄 [RFC 6749: The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749) — IETF, October 2012. Official docs. Checked 2026-11.
[^7]: 📄 [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — OpenID Foundation. Official docs. Checked 2026-11.
[^8]: 📄 [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700) — IETF, January 2025. Official docs. Checked 2026-11.
[^9]: 📄 [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) — Google for Developers. Official docs. Checked 2026-11.
[^10]: 📄 [Passkeys](https://fidoalliance.org/passkeys/) — FIDO Alliance. Official docs. Checked 2026-11.
[^11]: 📝 [2025 Data Breach Investigations Report](https://www.verizon.com/about/news/2025-data-breach-investigations-report) — Verizon. Article. Checked 2026-11.
[^12]: 📝 [New research: How effective is basic account hygiene at preventing hijacking](https://security.googleblog.com/2019/05/new-research-how-effective-is-basic.html?m=1) — Google Security Blog. Article. Checked 2026-11.
[^13]: 📄 [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^14]: 📄 [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) — AWS Identity and Access Management User Guide. Official docs. Checked 2026-11.
