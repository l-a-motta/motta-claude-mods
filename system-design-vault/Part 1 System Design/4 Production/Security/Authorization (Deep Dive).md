---
aliases: [Authorization deep dive]
tags: [level/deep-dive, part/1, section/production, branch/security]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Production]]"
branch: "[[Security]]"
basics: "[[Authorization]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Production]] › [[Security]] › [[Authorization]] › 🔬 Deep Dive

> [!tldr] For engineers
> Authorization evaluates `(subject, action, resource, context) → allow | deny` on every request, on the server, failing closed. The model (RBAC, ABAC, ReBAC) decides how expressive policies can be; the architecture (in-code checks, a policy engine, a central service like Zanzibar) decides how consistently they are enforced. Broken access control has topped the OWASP Top 10 since 2021, and its bug list is dominated by missing or misplaced checks, not weak models.

> [!basics]- New to this? Start with the basics
> [[Authorization]] explains it with no jargon.

## How it really works

Every authorization decision has the same inputs: **who** (the authenticated subject and its attributes), **what action**, **which resource**, and **context** such as time, network or device. A useful split separates the code that **decides** from the code that **enforces**: the service calls a decision function, then acts on the answer.

### Three policy models

**RBAC (role-based).** Users get roles; roles carry permissions. NIST formalized it in 1992 (Ferraiolo and Kuhn), and the NIST model became ANSI/INCITS 359-2004.[^1] Its strength is administration: security is managed at a level that "corresponds closely to the organization's structure."[^1] Its weakness is granularity. Per-tenant or per-object rules push teams to mint ever more roles, which OWASP calls **role explosion**.[^2]

**ABAC (attribute-based).** Decisions evaluate attributes of the subject, the resource, the action and the environment against policy rules.[^3] "Clinicians can read records of patients in their department during their shift" is one rule in ABAC and an unmanageable grid of roles in RBAC.

**ReBAC (relationship-based).** Access follows a graph of relationships between users and objects: owner of, member of, parent folder of.[^2] It fits collaborative products where sharing is the core feature. OWASP's cheat sheet recommends ABAC or ReBAC over pure RBAC for new systems, for finer-grained logic and better multi-tenant support.[^2]

### Zanzibar: ReBAC at planetary scale

Google's Zanzibar stores ACLs as **relation tuples** of the form `object#relation@user`, where the user may itself be a set:[^4]

```text
doc:readme#owner@10                      user 10 owns doc:readme
group:eng#member@11                      user 11 is in group:eng
doc:readme#viewer@group:eng#member       members of eng can view doc:readme
doc:readme#parent@folder:A#...           doc:readme lives in folder:A
```

Per-namespace **userset rewrite rules** derive implied relations without storing them: every owner is an editor, every editor a viewer, and viewers of the parent folder are viewers of the document.[^4] A check becomes "does user U have relation R to object O?", answered by walking that graph across servers.[^4]

The hard part is consistency. In the **new enemy problem**, Alice removes Bob from a folder, then new documents are moved into it; a check that ignores the order of those changes, or reads a stale ACL, could still let Bob see them.[^4] Zanzibar stores tuples in Spanner, whose TrueTime timestamps respect causal order, and hands clients an opaque **zookie** at content-write time. Later checks pass the zookie and are evaluated at a snapshot at least that fresh, so most checks can still be served from local replicas.[^4]

### Policy as code

A general-purpose engine such as **Open Policy Agent** takes structured JSON input and returns a decision computed from policies written in the declarative language Rego.[^5] The service enforces; OPA decides.[^5]

```rego
package app.authz

default allow := false            # fail closed

allow if {
    input.action == "read"
    input.resource.owner == input.user.id
}

allow if {
    "admin" in input.user.roles
}
```

### How AWS IAM evaluates a request

AWS is a widely used reference for evaluation order:[^6]

1. **Implicit deny.** Every request starts denied (the account root user is the only exception).
2. **Explicit deny wins.** One matching `Deny` in any applicable policy ends evaluation.
3. **Guardrails intersect.** Organization SCPs and RCPs, permission boundaries and session policies can only remove permissions; each must allow the action.
4. **Grants union.** Within an account, for most resources an allow in either the identity-based or the resource-based policy is enough; IAM role trust policies and KMS key policies are exceptions.[^6][^7]

```json
{ "Effect": "Deny", "Action": "s3:*", "Resource": "*",
  "Condition": { "Bool": { "aws:SecureTransport": "false" } } }
```

The statement above refuses any S3 call not made over TLS, regardless of what other policies allow; AWS recommends such conditions to narrow access further.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| RBAC | Simple to audit; maps to org charts | Role explosion; coarse for per-object rules |
| ABAC | Expressive; context-aware (time, device, tenant) | Attribute quality and freshness become security-critical |
| ReBAC (Zanzibar-style) | Natural for sharing, nesting, inheritance | Graph walks; consistency across replicas |
| Checks inline in each service | No network hop; easy start | Logic drifts and duplicates across services |
| Central policy engine or service | One policy, one audit trail, testable | Extra hop on the hot path; must be highly available |
| Enforce at the API gateway only | One choke point | Gateway cannot see object ownership; IDOR slips through |

Most production systems layer them: coarse RBAC at the gateway, fine-grained ownership or relationship checks inside the service that owns the data.

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Apps tested with some broken access control (OWASP 2025) | 100%[^9] |
| CWEs mapped to A01 (2025) / recorded occurrences | 40 / 1,839,701[^9] |
| Same category in OWASP 2021: CWEs / occurrences | 34 / 318,487[^10] |
| Zanzibar relation tuples stored | Over 2 trillion, close to 100 TB[^11] |
| Zanzibar client namespaces | Over 1,500[^11] |
| Zanzibar peak load | Over 10 million queries/s; Check peaks near 4.2M/s[^11] |
| Zanzibar Check latency, "safe" (staleness-tolerant) | p50 3.0 ms, p95 9.46 ms, p99 15.0 ms[^11] |
| Zanzibar availability over three years | Above 99.999%[^12] |
| Estimated industry savings from NIST RBAC work (RTI, 2010) | $1.1 billion[^1] |

Reads outnumber writes by two orders of magnitude in Zanzibar's workload, which is why caching and replica reads dominate its design.[^11]

## Failure modes

- **Insecure direct object references (IDOR).** Changing `/orders/1001` to `/orders/1002` returns someone else's order. Obscure IDs do not fix it; check ownership of the specific object on every request.[^2][^10]
- **Missing function-level checks.** Read endpoints are guarded but `POST`, `PUT` and `DELETE` are not, or admin pages are reachable by forced browsing.[^10]
- **Client-side enforcement.** Hiding UI is cosmetic; the server must decide.[^2]
- **Tampered claims.** Trusting a role from an unsigned cookie or a modified JWT lets users promote themselves.[^10]
- **Fail-open errors.** An exception in the policy path that defaults to allow. Centralize error handling and make the default deny.[^2]
- **Stale permissions.** Caches or replicas serve an ACL from before a revocation, the new enemy problem; Zanzibar's zookies exist to stop this.[^4]
- **Privilege creep.** Permissions accumulate as people change teams. Review periodically and remove what logs show is unused.[^2][^8]
- **SSRF.** OWASP 2025 folds server-side request forgery into this category: the server is tricked into using its own access on an attacker's behalf.[^9]

Defenses common to all: deny by default, one reusable enforcement path, log every denial and alert on repeats, and unit and integration tests that assert denials, not just successes.[^2][^10]

## In the real world

- **Google Zanzibar** backs authorization for Calendar, Cloud, Drive, Maps, Photos, YouTube and hundreds of other services, with p95 latency under 10 ms.[^12]
- **AWS IAM** combines identity policies, resource policies, permission boundaries and organization-wide SCPs and RCPs; IAM Access Analyzer can generate a least-privilege policy from a role's CloudTrail activity.[^6][^8]
- **Open Policy Agent** is a graduated Cloud Native Computing Foundation project used to externalize policy from services.[^5]

## In a design interview

Show where checks live and how they stay consistent:

1. **Model:** "Workspaces use roles (owner, editor, viewer); documents use sharing relationships, so ReBAC for objects."
2. **Enforcement:** "Gateway rejects unauthenticated calls and coarse scopes; each service checks object-level permission against the authz service."
3. **Consistency:** "Revocations must apply before new content is visible; we pass a version token, Zanzibar-style, or bypass caches on revocation."
4. **Defaults and audit:** "Deny by default, every denial logged, policy tests in CI."

Probes: *How do you list everything a user can see?* (Reverse index; checks alone are per-object.) *What happens if the authz service is down?* (Fail closed; cache recent decisions with short TTL.) *How do you avoid role explosion?* (Attributes or relationships for per-object rules.)

## Check yourself

> [!question]- Why does AWS make an explicit Deny override every Allow?
> It lets guardrails be written once and trusted. No matter how broad a later grant is, a deny in an SCP, boundary or policy still holds, so a mistake in one policy cannot open what another explicitly closed.

> [!question]- What is the "new enemy" problem and why does a cache make it worse?
> A user removed from an ACL can still see content added after the removal if the check reads an ACL snapshot older than the change. Caches and lagging replicas serve exactly those old snapshots, so checks need a freshness bound tied to the content version.

> [!question]- Your API gateway validates JWT scopes. Is that enough authorization?
> No. Scopes say what kind of operation a client may attempt, not whether this user owns order 1002. Object-level checks must run where the data and its ownership live.

## Further reading

- 🔬 [Zanzibar: Google's Consistent, Global Authorization System](https://www.usenix.org/conference/atc19/presentation/pang) — the reference design for relationship-based access control at scale.
- 📄 [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — concise, practical rules from least privilege to testing.
- 📄 [A01:2025 Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control) — the bug classes that actually ship, with prevention advice.
- 📄 [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) — a precise, real-world evaluation algorithm worth studying.
- 📄 [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest) — policy as code with Rego.

## Related

- [[Authentication (Deep Dive)]] — establishing the subject every decision depends on.
- [[Microservices (Deep Dive)]] — where to place checks across many services.
- [[API Design (Deep Dive)]] — scopes, object-level checks and error responses.
- [[Caching (Deep Dive)]] — caching decisions without serving stale permissions.
- [[Logging (Deep Dive)]] — audit trails of grants and denials.
- [[AI Agents & Tool Use (Deep Dive)]] — least privilege for tools an agent can call.

> [!nav] Keep going
> ← [[Authentication (Deep Dive)|Authentication]] · [[Security|🔒 Security]] · [[Encryption (Deep Dive)|Encryption]] →
> 🌱 Back to the basics: [[Authorization]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Role Based Access Control](https://csrc.nist.gov/Projects/Role-Based-Access-Control) — NIST Computer Security Resource Center. Official docs. Checked 2026-11.
[^2]: 📄 [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — OWASP Cheat Sheet Series. Official docs. Checked 2026-11.
[^3]: 📄 [Guide to Attribute Based Access Control (ABAC) Definition and Considerations](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) — NIST SP 800-162. Official docs. Checked 2026-11.
[^4]: 🔬 [Zanzibar: Google's Consistent, Global Authorization System (full paper, PDF)](https://www.usenix.org/system/files/atc19-pang.pdf) — Pang et al., USENIX ATC 2019, sections 2.1–2.4. Paper. Checked 2026-11.
[^5]: 📄 [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest) — Open Policy Agent. Official docs. Checked 2026-11.
[^6]: 📄 [How AWS enforcement code logic evaluates requests to allow or deny access](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html) — AWS Identity and Access Management User Guide. Official docs. Checked 2026-11.
[^7]: 📄 [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) — AWS Identity and Access Management User Guide. Official docs. Checked 2026-11.
[^8]: 📄 [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) — AWS Identity and Access Management User Guide. Official docs. Checked 2026-11.
[^9]: 📄 [A01:2025 Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control) — OWASP Top 10:2025. Official docs. Checked 2026-11.
[^10]: 📄 [A01:2021 Broken Access Control](https://top10.owasp.org/2021/A01_2021-Broken_Access_Control) — OWASP Top 10:2021. Official docs. Checked 2026-11.
[^11]: 🔬 [Zanzibar: Google's Consistent, Global Authorization System (full paper, PDF)](https://www.usenix.org/system/files/atc19-pang.pdf) — Pang et al., USENIX ATC 2019, section 4. Paper. Checked 2026-11.
[^12]: 🔬 [Zanzibar: Google's Consistent, Global Authorization System](https://www.usenix.org/conference/atc19/presentation/pang) — Pang et al., USENIX ATC 2019. Paper. Checked 2026-11.
