---
aliases: [Serverless deep dive]
tags: [level/deep-dive, part/1, section/architecture, branch/architecture-styles]
level: Deep Dive
part: "[[Part 1 System Design]]"
section: "[[Architecture]]"
branch: "[[Architecture Styles]]"
basics: "[[Serverless]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 1 System Design|Part 1]] › [[Architecture]] › [[Architecture Styles]] › [[Serverless]] › 🔬 Deep Dive

> [!tldr] For engineers
> Serverless hands **provisioning, patching and autoscaling** to the provider and bills by consumption, typically **requests plus GB-seconds**. FaaS runs short-lived, stateless handlers in isolated sandboxes that are created on demand (cold start) and reused while warm. It shines for spiky, event-driven and embarrassingly parallel work; it struggles with steady high-throughput load, long-running jobs, and anything that needs functions to share data or talk to each other directly.

> [!basics]- New to this? Start with the basics
> [[Serverless]] explains it with no jargon.

## How it really works

The Berkeley view defines serverless computing as a model in which the platform **handles virtually all system administration**, which the authors compare to moving from assembly to high-level languages.[^1] It has two halves:[^2]

- **FaaS:** your code runs in stateless, event-triggered, vendor-managed containers. AWS Lambda is a common example.
- **BaaS:** hosted services such as databases and authentication that replace server-side components you would otherwise run.

### The Lambda execution environment

Lambda runs each function in an **execution environment** with three phases:[^3]

1. **Init.** Start extensions, bootstrap the runtime, run your static code outside the handler. Capped at 10 seconds on demand.
2. **Invoke.** Run the handler; the function timeout bounds this phase.
3. **Shutdown.** Lambda signals extensions, then freezes or destroys the environment.

Between invocations the environment is **frozen** and may be **thawed** for the next request. Objects created outside the handler survive, so database clients and SDK connections can be reused.[^3] Lambda still recycles environments every few hours, even under constant traffic, so nothing may assume persistence.[^3]

```python
import boto3

s3 = boto3.client("s3")            # Init: runs once per environment, reused while warm

def handler(event, context):       # Invoke: runs per request
    obj = s3.get_object(Bucket=event["bucket"], Key=event["key"])
    return {"size": obj["ContentLength"]}
```

A **cold start** is downloading code and setting up a new environment; it is billed and adds latency.[^3] AWS reports cold starts in under 1% of invocations, lasting from under 100 ms to over 1 second, and more common in rarely invoked dev and test functions.[^3] Mitigations: **provisioned concurrency** pre-initializes a fixed number of environments; **SnapStart** snapshots an initialized environment at publish time and restores from it; and lean static initialization cuts the rest.[^3]

### Under the hood: Firecracker

Lambda isolates tenants with **Firecracker**, an open-source virtual machine monitor built on KVM.[^4] With a minimal guest kernel, a microVM has under 5 MB of memory overhead, boots to application code in under 125 ms, and a host can create up to 150 microVMs per second.[^4] Each Lambda worker runs hundreds or thousands of microVMs, each holding one **slot** for a single function, and a slot serves one concurrent invocation at a time.[^4] Because even 125 ms is too slow on the scale-up path, workers keep a small pool of pre-booted microVMs, sized with Little's law.[^4]

Requests are **sticky-routed** to as few workers as possible for cache locality; the Worker Manager doing that routing handles millions of requests per second at under 10 ms p99.9.[^4]

### The isolate alternative

Cloudflare Workers take a different route: V8 **isolates** inside one runtime process, not a VM per function. Cloudflare says an isolate starts about a hundred times faster than a Node process in a container or VM and uses an order of magnitude less memory at startup.[^5] The trade-off is that code must fit the isolate runtime rather than a full Linux environment.

### The product has grown

As of late 2026, AWS documents three Lambda compute types: **Event Functions** (the classic model), **Web Functions** that run an HTTP server with many concurrent requests per environment, and **MicroVMs** for persistent, isolated sessions of up to 8 hours.[^6] Durable Functions add checkpointed workflows that can run for up to a year.[^6]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| FaaS vs always-on containers | No idle cost; autoscaling to zero; no patching[^6] | Cold starts; duration and payload limits; per-unit compute premium |
| Provisioned concurrency | Predictable latency | You pay while it is enabled, used or not[^7] |
| More memory | Proportionally more CPU; 1,769 MB = one vCPU[^8] | Higher GB-second price per ms |
| Chaining functions | Small, single-purpose units | Latency and cost add up per hop; state goes through storage[^9] |
| Step-function orchestration | Visible, retryable workflows | Per-transition cost and account limits at scale[^10] |
| VM isolation (Firecracker) | Strong multi-tenant security[^4] | Boot cost, hence warm pools |
| Isolate isolation (Workers) | Very fast starts, low memory[^5] | Language and runtime constraints |

### Cost shape

Event Function pricing in US East (x86) is **$0.20 per million requests** plus **$0.0000166667 per GB-second**, with a monthly free tier of 1M requests and 400,000 GB-seconds.[^7] Initialization code is billed too.[^7]

```text
Spiky:  1M requests/month x 0.2 s x 1 GB = 200,000 GB-s  ->  ~$3.33 + $0.20
Steady: 100 req/s, 24x7, 0.2 s, 1 GB      = 51.8M GB-s/month ->  ~$864 + ~$52 in requests
```

The first is nearly free; the second keeps about 20 GB of memory busy around the clock, which is where reserved servers or containers usually win. That is the [[Cost Optimization (Deep Dive)|cost]] lesson behind the Prime Video case.[^10]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Max Event Function timeout | 900 s (15 minutes); 90 min for async on Lambda Managed Instances[^8] |
| Memory range | 128 MB to 10,240 MB[^8] |
| Default concurrency per Region | 1,000, raisable to tens of thousands[^8] |
| Scale-up rate per function | 1,000 execution environments every 10 seconds[^8] |
| Invocation payload | 6 MB sync each way; 1 MB async[^8] |
| Package size | 250 MB unzipped (zip); 10 GB container image[^8] |
| Init phase limit (on demand) | 10 seconds[^3] |
| Cold start frequency and duration | <1% of invocations; <100 ms to >1 s[^3] |
| Firecracker microVM | <125 ms boot, <5 MB overhead, 150 per second per host[^4] |
| Lambda scale (2020) | Trillions of requests per month across millions of workloads[^4] |
| Function network bandwidth (2018 study cited by Hellerstein et al.) | ~538 Mbps for one function; ~28.7 Mbps each with 20 packed together[^9] |
| Network bandwidth per execution environment (2026 quota) | 625 Mbps by default[^8] |

## Failure modes

- **Cold-start tail latency.** Rarely used or freshly scaled functions add hundreds of milliseconds. Defend with provisioned concurrency, SnapStart, smaller packages and importing only needed SDK clients.[^3]
- **Quota mismatches.** API Gateway's default 10,000 requests per second can outrun Lambda's default 1,000 concurrency, so requests are throttled. Load-test and raise quotas ahead of launch.[^8]
- **Downstream overload.** Autoscaling functions can open thousands of database connections at once. Reuse connections created during Init[^3] and cap the function's concurrency.
- **Data shipping.** Functions are isolated from data, short-lived and not network-addressable, so they talk through storage and "ship data to code".[^9] Hellerstein et al. call this an architectural antipattern and argue it stymies distributed computing.[^9]
- **Too-fine decomposition.** Prime Video's monitoring pipeline passed video frames between steps through S3 and hit Step Functions state-transition limits; it reached only about 5% of expected load before being consolidated.[^10]
- **Leaking state between invocations.** Globals and `/tmp` survive warm reuse. Keep per-request data inside the handler.[^3]
- **Lock-in.** Code and architecture lean on one vendor's triggers and services, making a move costly.[^2]

## In the real world

- **BBC** renders about half of BBC Online with Lambda, at roughly 2,000 invocations per second, most under 150 ms. Its head of architecture argued that per-unit compute costs more but less is needed, with no idle capacity held for news spikes.[^11]
- **Prime Video** moved one sustained, data-heavy workload off Step Functions and Lambda onto ECS, cutting operating cost by 90%.[^10]
- **AWS Lambda** runs on Firecracker; AWS migrated customers from per-customer EC2 isolation to Firecracker on bare metal starting in 2018 with no availability impact.[^4]
- **Cloudflare Workers** run on V8 isolates across hundreds of edge locations.[^5]

## In a design interview

Use serverless for the parts where its shape fits, and say where it doesn't.

1. **Good fits:** "Thumbnail generation on upload, webhook handlers, nightly jobs, a low-traffic admin API."
2. **Bad fits:** "The hot path at a steady 5,000 req/s, long video transcodes, a WebSocket hub."
3. **Guardrails:** "Reserved concurrency to protect the database, a queue in front for bursts, idempotent handlers because async invokes retry."

Interviewers probe: *What about cold starts?* (Measure p99; provisioned concurrency for latency-critical paths.) *How do functions share state?* (They don't; use a cache or database.) *When is it more expensive?* (Sustained high utilization; do the GB-second math.)

## Check yourself

> [!question]- Why should database clients be created outside the handler?
> Init code runs once per execution environment, and the environment is reused while warm. Creating the client there reuses connections across invocations and shortens every warm request.

> [!question]- Why does Lambda keep a pool of pre-booted microVMs if Firecracker boots in about 125 ms?
> Scale-up can sit on the user's request path, so even 125 ms is too slow. Little's law sizes the pool: creation rate times creation latency.

> [!question]- Two functions must exchange 10 GB of intermediate data. What is the problem?
> FaaS functions are not directly addressable, so the data must go through storage such as S3, adding latency and cost. A long-running container or a batch engine keeps data local.

## Further reading

- 🔬 [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/conference/nsdi20/presentation/agache) — how Lambda actually isolates and places functions.
- 🔬 [Serverless Computing: One Step Forward, Two Steps Back](https://arxiv.org/abs/1812.03651) — the sharpest critique of first-generation FaaS.
- 📄 [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) — Init, Invoke, Shutdown and cold starts from the source.
- 📝 [Serverless Architectures](https://martinfowler.com/articles/serverless.html) — a long, balanced survey of benefits and drawbacks (2018).
- 🔬 [Cloud Programming Simplified: A Berkeley View on Serverless Computing](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2019/EECS-2019-3.html) — the optimistic research agenda.

## Related

- [[Microservices (Deep Dive)]] — serverless as a deployment model for services.
- [[Monoliths (Deep Dive)]] — consolidation as the fix for over-fine decomposition.
- [[Message Queues (Deep Dive)]] — buffering bursts in front of functions.
- [[Object Storage (Deep Dive)]] — the storage functions use to pass data.
- [[Cloud & Infrastructure (Deep Dive)]] — compute choices for AI workloads.
- [[AI Agents & Tool Use (Deep Dive)]] — sandboxed, on-demand execution for agent tools.

> [!nav] Keep going
> ← [[Microservices (Deep Dive)|Microservices]] · [[Architecture Styles|🧱 Architecture Styles]] · [[SQL Databases (Deep Dive)|SQL Databases]] →
> 🌱 Back to the basics: [[Serverless]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🔬 [Cloud Programming Simplified: A Berkeley View on Serverless Computing](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2019/EECS-2019-3.html) — Jonas et al., UC Berkeley EECS-2019-3, 2019. Paper. Checked 2026-11.
[^2]: 📝 [Serverless Architectures](https://martinfowler.com/articles/serverless.html) — Mike Roberts, martinfowler.com, 2018. Article. Checked 2026-11.
[^3]: 📄 [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) — AWS Lambda Developer Guide. Official docs. Checked 2026-11.
[^4]: 🔬 [Firecracker: Lightweight Virtualization for Serverless Applications (PDF)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf) — Agache et al., USENIX NSDI 2020, sections 1 and 4. Paper. Checked 2026-11.
[^5]: 📄 [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/) — Cloudflare Workers documentation. Official docs. Checked 2026-11.
[^6]: 📄 [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html) — AWS Lambda Developer Guide. Official docs. Checked 2026-11.
[^7]: 📄 [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/) — Amazon Web Services. Official docs. Checked 2026-11.
[^8]: 📄 [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) — AWS Lambda Developer Guide. Official docs. Checked 2026-11.
[^9]: 🔬 [Serverless Computing: One Step Forward, Two Steps Back (PDF)](https://arxiv.org/pdf/1812.03651) — Hellerstein et al., CIDR 2019, section 3. Paper. Checked 2026-11.
[^10]: 📝 [Prime Video Switched from Serverless to EC2 and ECS to Save Costs](https://infoq.com/news/2023/05/prime-ec2-ecs-saves-costs) — Rafał Gancarz, InfoQ, 2023. Article. Checked 2026-11.
[^11]: 📝 [BBC makes switch to AWS, serverless for new website architecture, observers grumble about the HTML](https://www.theregister.com/2020/11/04/bbc_embraces_aws_serverless/) — Tim Anderson, The Register, 2020. Article. Checked 2026-11.
