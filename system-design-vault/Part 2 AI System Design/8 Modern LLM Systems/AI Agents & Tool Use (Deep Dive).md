---
aliases: [AI Agents & Tool Use deep dive]
tags: [level/deep-dive, part/2, section/modern-llm-systems]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[Modern LLM Systems]]"
basics: "[[AI Agents & Tool Use]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[Modern LLM Systems]] › [[AI Agents & Tool Use]] › 🔬 Deep Dive

> [!tldr] For engineers
> Tool use is a structured round trip: the model emits a typed call against a JSON Schema, your runtime executes it and returns a result, and the loop repeats until the model stops or a budget trips. **Workflows** hard-code that control flow; **agents** let the model own it, buying flexibility with tokens, latency and compounding errors. MCP standardizes the tool boundary over JSON-RPC, and the hard engineering is in tool design, permissions, checkpoints and evaluation.

> [!basics]- New to this? Start with the basics
> [[AI Agents & Tool Use]] explains it with no jargon.

## How it really works

### The tool-call round trip

Every major API follows the same shape:[^1][^2]

1. The request carries `tools`: each a name, description and JSON Schema for its parameters.
2. The model returns either text or one or more tool calls with an ID, a name and JSON arguments. On Claude the response has `stop_reason: "tool_use"`.
3. Your code runs each call and appends a result referencing its ID (`tool_result` on Claude, `function_call_output` on OpenAI).
4. You call the model again with the extended history, and repeat.

```python
messages = [{"role": "user", "content": goal}]
for step in range(MAX_STEPS):                      # hard stop
    resp = llm.create(tools=TOOLS, messages=messages)
    calls = [b for b in resp.content if b.type == "tool_use"]
    if not calls:
        return resp                                 # model chose to answer
    messages.append({"role": "assistant", "content": resp.content})
    results = [run_checked(c) for c in calls]       # authz, validation, approval
    messages.append({"role": "user", "content": results})
raise BudgetExceeded(step)
```

**Client tools** run in your process; **server tools** (web search, code execution) run on the provider's side and come back already executed.[^1] `tool_choice` steers behavior: `auto` lets the model decide, `required` (`any` on Claude) forces a call, a named tool forces that one, and `none` disables tools.[^2][^1] **Strict mode** constrains arguments to the schema instead of best effort; OpenAI's guide recommends always enabling it.[^2] Models can emit several calls in one turn (parallel tool use) unless you disable it.[^2]

Tools are not free: definitions count as input tokens on every call, and Claude adds a tool-use system prompt of 286–675 tokens on current models with `tool_choice: auto`, depending on the model.[^1]

### From augmented LLM to agent

Anthropic's building block is the **augmented LLM**: a model with retrieval, tools and memory. On top sit five composable workflow patterns: **prompt chaining**, **routing**, **parallelization** (sectioning or voting), **orchestrator-workers** and **evaluator-optimizer**.[^3] An **agent** is the degenerate case where the model plans and acts in a loop, getting "ground truth" from tool results at each step, with stopping conditions such as a maximum number of iterations.[^3]

The academic root is **ReAct**, which interleaves reasoning traces with actions; with a simple Wikipedia API it reduced hallucination versus chain-of-thought alone, and it beat imitation and RL baselines by 34 and 10 points absolute on ALFWorld and WebShop.[^4]

### Multi-agent orchestration

Anthropic's Research system is orchestrator-workers at scale: a lead agent writes a plan to memory, spawns subagents with their own context windows that search in parallel, then compresses their findings.[^5] Separate context windows let subagents compress what they find, so the lead works from distilled findings rather than raw pages.[^5]

### Model Context Protocol

MCP standardizes the boundary between an AI application and the systems it uses.[^6] Its architecture:[^7]

- **Host** (Claude Code, VS Code, an IDE or chat app) creates one **client** per **server**; each pair has a dedicated connection.
- **Data layer:** JSON-RPC 2.0. Servers expose three primitives: **tools** (actions), **resources** (read-only context) and **prompts** (templates). Clients can expose **elicitation** to ask the user for input.
- **Transport layer:** **stdio** for local subprocess servers; **Streamable HTTP** (POST plus optional Server-Sent Events) for remote ones, with OAuth recommended for tokens.
- As of protocol version `2026-07-28` each request carries its version and capabilities in `_meta`, so servers infer nothing from earlier requests; `server/discover` advertises capabilities, and sampling and logging are deprecated.[^7]

```json
{"jsonrpc": "2.0", "id": 3, "method": "tools/call",
 "params": {"name": "weather_current",
            "arguments": {"location": "San Francisco", "units": "imperial"}}}
```

Discovery is `tools/list`; change notifications such as `notifications/tools/list_changed` arrive on an opt-in `subscriptions/listen` stream and are best effort.[^7] Anthropic launched MCP in November 2024 with reference servers for Google Drive, Slack, GitHub, Git, Postgres and Puppeteer.[^8]

## Design choices and trade-offs

| Choice | Gains | Costs |
| --- | --- | --- |
| Single LLM call + retrieval | Cheapest, fastest, predictable | Can't handle open-ended tasks |
| Workflow (fixed code path) | Testable, bounded cost | Brittle when steps vary |
| Single agent loop | Adapts to unknown step counts | ~4× chat tokens; compounding errors[^5] |
| Multi-agent (orchestrator-workers) | Parallel breadth; big quality gains on research | ~15× chat tokens; poor fit for tightly coupled tasks like most coding[^5] |
| Many fine-grained tools | Precise actions | Selection errors; token overhead |
| Few coarse tools | Easier choice, fewer calls | Less control, broader permissions |
| Framework | Fast start | Hides prompts and responses, harder to debug[^3] |

Anthropic's advice is to start with the simplest option and add agentic complexity only when it measurably helps.[^3]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Multi-agent vs. single agent on Anthropic's research eval | +90.2%[^5] |
| Share of BrowseComp performance variance explained by token usage | 80%[^5] |
| Token use vs. chat: single agent / multi-agent | ~4× / ~15×[^5] |
| Research time cut by parallel tool calls | Up to 90%[^5] |
| Task time saved by rewriting tool descriptions | 40%[^5] |
| Suggested tools available at start of a turn | Fewer than 20[^2] |
| Claude tool-use system prompt overhead | 286–675 tokens on current models (`auto`)[^1] |
| ReAct gains on ALFWorld / WebShop | +34 / +10 points absolute[^4] |

## Failure modes

- **Compounding errors.** A small mistake early is carried through every later step. Anthropic resumes from checkpoints instead of restarting, and combines model adaptability with retry logic.[^5]
- **Runaway loops and over-delegation.** Early versions spawned excessive subagents for simple queries and searched the web endlessly.[^5] Defend with step, token and wall-clock budgets plus effort-scaling rules in the prompt.
- **Bad tool ergonomics.** Ambiguous parameters cause wrong calls; switching to absolute file paths fixed a class of SWE-bench errors.[^3] Treat tool descriptions as prompts and test them.
- **Excessive agency.** Tools with more functionality, permissions or autonomy than needed turn a hallucination or injection into real damage.[^9] Use narrow tools, per-user scoped credentials, and human approval for high-impact actions; enforce authorization downstream, never in the prompt.[^9]
- **Injection through tool results.** Web pages, emails and files returned by tools can carry instructions; see [[Guardrails & AI Safety (Deep Dive)]].
- **Deploy disruption.** Long-running agents break if code changes under them; Anthropic uses rainbow deployments to shift traffic gradually.[^5]
- **Non-deterministic debugging.** Full production tracing of decisions and tool calls is the only way to reconstruct why an agent failed.[^5]

## In the real world

- **Anthropic Research** — orchestrator-worker multi-agent search with Claude Opus 4 as lead and Sonnet 4 subagents.[^5]
- **Claude Code and VS Code** — act as MCP hosts connecting to local and remote MCP servers.[^7]
- **Block, Apollo, Zed, Replit, Codeium, Sourcegraph** — early MCP adopters at launch.[^8]
- **OpenAI** — namespaces, tool search and strict schemas for large tool sets.[^2]

## In a design interview

1. **Justify the agent.** "Steps vary per ticket, so a fixed workflow breaks; but refunds go through a deterministic sub-workflow."
2. **Define tools as APIs.** Names, schemas, idempotency keys, narrow scopes; IDs passed from code, not guessed by the model.[^2]
3. **Bound the loop.** Max steps, token budget, timeout, and a clear "done" signal.
4. **Permissions.** Act as the end user with scoped OAuth tokens; human approval on irreversible actions.[^9]
5. **Reliability.** Checkpoint state after each step; retry tools with backoff; make tools idempotent so a retry is safe.
6. **Evaluate.** Judge outcomes, not paths, with a rubric-based LLM judge plus human review.[^5]

Interviewers probe: *What stops an infinite loop?* *What if a tool call times out halfway?* *How do you prevent a prompt-injected email from triggering a transfer?* *How do you cost it?*

## 🧱 Builds on

- [[API Design]] — tool schemas are API contracts the model consumes: clear names, typed inputs, enums and idempotent operations reduce misuse.
- [[Authorization]] — complete mediation and least privilege in downstream systems; the agent carries the user's scoped token, never a superuser key.
- [[Fault Tolerance]] — checkpoints, retries with backoff and idempotency keep multi-step runs recoverable when one step fails.
- [[Message Queues]] — long-running and parallel subagent work decouples via queues or durable task handles (MCP's Tasks extension returns one for polling).[^7]

## Check yourself

> [!question]- Why pass `order_id` from application code instead of making it a tool parameter the model fills?
> The model might guess or hallucinate it. Values your code already knows should never depend on generation; that also narrows what a prompt injection can change.

> [!question]- Multi-agent improved quality by 90% on research. Why not use it for a coding agent?
> It burns about 15× the tokens of chat and suits breadth-first, parallel tasks. Most coding needs shared, tightly coupled context that splits poorly across subagents.

> [!question]- Your agent occasionally sends duplicate refund requests after timeouts. What do you change?
> Make the refund tool idempotent with a key tied to the agent step, and checkpoint completed steps so a retry resumes rather than repeats.

## Further reading

- 📝 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — the clearest taxonomy of workflows vs. agents, with when to use each.
- 📝 [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — production lessons on evals, cost and failure.
- 📄 [MCP architecture overview](https://modelcontextprotocol.io/docs/learn/architecture) — hosts, clients, servers and the JSON-RPC data layer.
- 📄 [Function calling](https://developers.openai.com/api/docs/guides/function-calling) — practical tool-schema best practices.
- 🔬 [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — the paper behind the reason-act loop.

## Related

- [[Guardrails & AI Safety (Deep Dive)]] — injection, excessive agency and approval gates.
- [[Context Engineering (Deep Dive)]] — managing the context an agent loop keeps growing.
- [[Retrieval-Augmented Generation (Deep Dive)]] — retrieval as a tool vs. a fixed step.
- [[API Design (Deep Dive)]] — contracts, versioning and idempotency for tools.
- [[Fault Tolerance (Deep Dive)]] — retries, checkpoints and graceful degradation.

> [!nav] Keep going
> ← [[LLM Inference & Optimization (Deep Dive)|LLM Inference & Optimization]] · [[Modern LLM Systems|🤖 Modern LLM Systems]] · [[Guardrails & AI Safety (Deep Dive)|Guardrails & AI Safety]] →
> 🌱 Back to the basics: [[AI Agents & Tool Use]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 📄 [Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — Anthropic, Claude API documentation. Official docs. Checked 2026-11.
[^2]: 📄 [Function calling](https://developers.openai.com/api/docs/guides/function-calling) — OpenAI API documentation. Official docs. Checked 2026-11.
[^3]: 📝 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — Anthropic Engineering, 2024. Engineering blog. Checked 2026-11.
[^4]: 🔬 [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — Yao et al., 2022. Paper. Checked 2026-11.
[^5]: 📝 [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Anthropic Engineering, 2025. Engineering blog. Checked 2026-11.
[^6]: 📄 [What is the Model Context Protocol (MCP)?](https://modelcontextprotocol.io/docs/getting-started/intro) — Model Context Protocol documentation. Official docs. Checked 2026-11.
[^7]: 📄 [Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture) — Model Context Protocol documentation. Official docs. Checked 2026-11.
[^8]: 📝 [Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) — Anthropic, 2024. Announcement. Checked 2026-11.
[^9]: 📄 [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — OWASP Gen AI Security Project. Standard. Checked 2026-11.
