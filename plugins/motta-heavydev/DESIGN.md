# /motta-heavydev — design

The source of truth for the flow. Change it here first, then build to it; assumptions still to be tested are listed at the end.

## Purpose

A tech-agnostic, multi-agent flow for **large changes or new projects**, started from an issue that describes the user need. It exists to prevent the usual AI failures: misread intent, ignorance of the user's external constraints or unstated wishes, unplanned changes, bloat, and "done" claims nobody verified.

Principles:

- **Intent before design.** The user's constraints enter through an interview before any agent designs anything; the architecture loop never calls the user.
- **Evidence over scores.** Every gate is pass/fail with cited evidence, never a self-reported confidence number.
- **No silent scope.** Anything beyond the request must be listed for the user's consent.
- **Every step is resumable.** A hard stop at any moment loses at most the step in flight.
- **Everything is configurable**, and nothing about a specific repo's stack is hardcoded — repo specifics live in that repo's playbook.

## Invocation — manual only

The flow starts **only** when the user types the command. The skill sets `disable-model-invocation: true`; there are no hooks, labels, cron jobs, loops or self-scheduled resumes. Agents spawned by the flow are told they may not invoke it.

```
/motta-heavydev <issue> [--budget=<n>] [--store=<owner>/<repo>] [--<setting>=<value> ...]
/motta-heavydev resume <issue>
/motta-heavydev status <issue>
```

## Roles

| Role                  | Default model    | Runs                                                       |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| Intent interviewer    | main session     | once, interactively (Matt's `grilling` skill)              |
| Scout                 | Sonnet           | once per architecture run — writes the shared brief       |
| Architect-Conservative| Opus             | each round                                                 |
| Architect-Bold        | Opus             | each round                                                 |
| Critic                | Opus             | each round, per plan; again on the diff                    |
| Auditor               | **Fable — 1 call** | once per architecture run, after both plans pass         |
| Comparator            | Sonnet, low effort | once per architecture run, after the audit — builds the pick table |
| Playbook drafter      | Sonnet           | once per repo (and on refresh) — drafts the playbook and its questions |
| Developer             | Sonnet (Opus when the plan is marked hard) | per milestone                    |
| QA                    | Sonnet           | per acceptance scenario                                    |

Models are set **explicitly per role** from configuration; agents never inherit the main session's model.

**Authorship.** Every artifact and issue comment starts with `Author: <Role>-<Model>` (e.g. `Critic-Opus-5.5`, `Auditor-Fable-5.1`). The workflow script stamps it from configuration — the agent never self-reports its model. User decisions are stamped `Author: User (@<github-handle>)`.

## The flow

```
0. Playbook check ── missing? → build it with the user, then continue
1. Intent interview (user) ─────────────→ intent record
2. Scout ───────────────────────────────→ shared brief (cached for 3–5)
3. Architecture loop (≤ 3 rounds)
     Conservative ─┐
                   ├→ Critic per plan → objection ledger → revise
     Bold ─────────┘
4. Auditor (Fable, once) → blockers join the ledger, loop continues with the Opus critic
   Comparator → side-by-side table, convergence flag
5. User picks a plan (or restarts 3 with feedback to all roles)
6. Developer, milestone by milestone, on the issue branch
7. Critic reviews the diff against the approved plan
8. QA runs the acceptance scenarios against the running system
     notable finding → user decides → back to 6
9. PR opened. Review and merge are the user's.
```

User touchpoints: intent interview, plan pick, QA escalations, Developer major-deviation escalations, diff-review escalations, PR review.

**Escalating ends the workflow.** Workflows run in the background and cannot talk to the user, so no agent ever "asks the user" from inside one. Any escalation (major deviation, QA crash, a failing diff review) ends that workflow with a `needs-user` result; the main session presents it at a touchpoint, and the next workflow resumes from the step records.

**At every touchpoint, questions are free and only commands act:**

- Each touchpoint has a small set of explicit commands (at the plan pick: `pick conservative`, `pick bold`, `restart: <feedback>`, `pause`). Any other message is a question — it never restarts, edits or advances anything.
- A message that reads like a decision ("Bold, but drop the X refactor") is confirmed with the user before anything happens.
- **Answers.** The main session answers from the artifacts (plans, ledger, brief, audit), reading the repo when needed, stamped `Author: Session-<model>` — its answers are interpretation, not the author's voice. When a question needs the author's own reasoning, it offers a **consult**: one fresh call to that plan's architect with its plan, the brief and the question, stamped `Author: Architect-<brief>-<model> (consult)`. A consult costs a call, so it runs only on the user's yes.
- **The session never edits a plan.** If the questions surface something to change, it drafts restart feedback from the conversation; the user confirms or edits it before the loop restarts.
- A short summary of the Q&A goes into that touchpoint's issue comment, so the record shows what informed the decision (`log-qa`, on by default).

### 1. Intent interview

Matt's `grilling` skill (not `grill-with-docs`, which writes ADRs and a glossary into the target repo). The interviewer works the decision tree in rounds, each question with a recommended answer, and looks up facts itself — it only asks the user for decisions. Its output is the **intent record**, saved to the store; every later role works from it.

### 2. Scout

Reads the target repo once, guided by the playbook and the intent record, and writes a **shared brief**: the relevant code, patterns, constraints and conventions. Architects and critic consume the brief instead of each re-exploring the repo. The saving is in exploration, not caching — the prompt cache is not shared across agents (see [Verified](#verified-phase-0-probe-2026-10-09)).

### 3. Architecture loop

Two architects with different briefs propose plans in parallel; the critic reviews each plan **against its own architect's brief**, so pressure from the critic does not collapse the two plans into one.

**Briefs:**

- **Architect-Conservative** — the smallest change that fully meets the intent record. Reuses existing patterns and modules, does not refactor adjacent code, adds a dependency only when unavoidable, prefers reversible steps.
- **Architect-Bold** — the best long-term design for the intent record. May refactor adjacent code, introduce an abstraction or dependency, or restructure — when it pays off, and every such change is on the consent list with its justification.
- Both must pass every criterion. For Bold, criterion 2 means each departure from the minimal change must earn its place — judged on the plan alone, since the critic never sees the conservative plan.

**Rules:**

- **Blind to each other.** Each architect sees only the intent record, the shared brief and its own critic verdicts — never the other plan. Only the user sees both, and can combine them through restart feedback.
- **No forced difference.** If Bold finds no departure that earns its place, the comparator marks the plans **converged** and the user sees one plan, with a note that Bold found nothing worth the extra risk.
- **Reframing note.** Each architect may attach at most one note questioning the request itself ("the issue asks for X, but Y meets the underlying need better"). It sits outside the plan, is never scored by the critic and never changes the plan's scope; the user sees it at the pick and may act on it through restart feedback.

**Plan template:**

```
Summary              ≤ 5 lines, readable on its own
Approach             the design and why
Changes              by area — new / modified / deleted files or modules
Milestones           M1..Mn
Acceptance scenarios S1..Sn
Requires your consent
Out of scope         stated explicitly
Assumptions          each cited or flagged
Risks                each with a mitigation
Rollback             when criterion 9 applies
Size · Difficulty    milestones · files touched · S/M/L · normal/hard
```

The reframing note is attached separately, never part of the plan. "Out of scope" is the mirror of the consent list: it names what the architect deliberately left out, so the critic and the user can check it against the intent.

- **Milestone:** goal, files, depends-on, and a checkable **done-when** ("checks pass and S2 can be demonstrated", not "feature implemented"). **Every milestone leaves the repo green** — build and tests pass — so each one is a safe resume point and a self-standing commit.
- **Acceptance scenario:** id, QA level tag (`basic` | `full`), actor (who QA plays), preconditions and test data, client-level steps (never code), and expected behaviour stated as something observable, never exact wording. **Every plan has at least one failure-path scenario** (error, unauthorised user, bad input) — the critic checks it under criterion 7. Every scenario the user approves is binding: a failure escalates.
- **Difficulty:** the architect proposes it, the critic confirms it, the user may override it at the pick. _Hard_ moves the Developer to Opus.
- **Size** is milestones, files touched and S/M/L — no time or token estimates; real figures come from runs.
- **Language:** English by default (`language` setting).

**Critic criteria** — each pass/fail with cited evidence (file paths, existing patterns, real constraints):

| #  | Criterion                                                                 | Applies                               |
| -- | ------------------------------------------------------------------------- | ------------------------------------- |
| 1  | Works under current circumstances — checked against the code, not the plan's claims | always                 |
| 2  | No bloat or pollution                                                     | always                                |
| 3  | Matches the intent record                                                 | always                                |
| 4  | No unpredicted change outside the consent list                            | always                                |
| 5  | Complete — every requirement in the intent record is covered              | always                                |
| 6  | Assumption honesty — every claim about code or external systems is cited or flagged | always                      |
| 7  | Verifiable — every change maps to an acceptance scenario or test          | always                                |
| 8  | Implementable — milestones concrete enough that the Developer makes no design decisions | always                    |
| 9  | Reversible — rollback path; data, migration and infra changes called out  | when it touches data, infra or deploys |
| 10 | Security — auth boundaries, secrets, PII                                  | when it touches them                  |

**Pass** = every applicable criterion passes and the plan has zero blocking objections.

**The critic:**

- **Stance:** a plan is wrong until the code shows otherwise.
- **Sees one plan only** — its own plan, that plan's ledger, the intent record, the shared brief and the playbook's safety boundaries. Never the other plan.
- **Read-only access** to the target repo: file reads, search, git history. It runs no commands.
- **Starts fresh each round** (no drift toward approval), carrying the ledger: it must close or keep each open objection explicitly, then look for new ones.
- **Never designs.** An objection states what would close it, not the solution — otherwise the critic becomes a third architect pulling both plans toward its own design.
- **Decides whether criteria 9 and 10 apply**, with a stated reason either way.
- **New objections are allowed in any round**, tagged with the round they were raised in, so late objections are visible; the round cap bounds goalpost-moving.

**Objection ledger.** One entry per objection, enforced by the workflow's structured-output schema — an objection missing a field, evidence included, is rejected:

```
id           O-B-3                       plan (C/B) + sequence
author       Critic-Opus-5.5 | Auditor-Fable-5.1
criterion    1–10
title        short title
severity     blocking | advisory
claim        what is wrong
evidence     file:line / doc / intent-record line — required
closes-when  the condition that resolves it (not a solution)
status       open | closed | disputed
rounds       opened, closed
closing evidence
architect response   fixed (how) | disputed (counter-evidence)
```

- **Severity.** _Blocking_ means a criterion fails. _Advisory_ is a suggestion: it never blocks a pass, the architect may ignore it, and the user sees it at the pick.
- **Disputes.** An architect may dispute an objection with counter-evidence (code, the intent record); the critic accepts the dispute or upholds the objection. Still disputed after two rounds → it goes to the user labelled _disputed_, with both sides' evidence, and does not count against the pass.

**Score summary.** Shown to the user, never used as the gate: `8/10 pass · 0 blocking · 2 advisory · 1 disputed`, followed by a short title for each failing criterion (e.g. `✗ 5 Complete — CSV export not covered`).

**Termination.** The loop ends when both plans pass, or after **3 rounds** (or earlier if a round makes no progress). Plans that did not pass go to the user anyway, with their open objections attached.

### 4. Auditor

One Fable call audits both passing plans before the user sees them. Blocking findings join the ledger and the loop continues with the Opus critic, within the round cap; the auditor is not called again. The user sees the auditor's findings and how each was resolved.

A restart is a new architecture run, so it gets its own auditor call by default — a restarted plan can change substantially, and one that reaches the user unaudited has skipped the strongest gate. Setting: `--auditor-on-restart=false`.

### 5. Plan pick

The user sees a **side-by-side table** built by the comparator (score summary, scope, files touched, risks, consent items, effort, open and disputed objections, reframing notes), with full plans linked. The user picks one, or restarts the loop with feedback that goes to both architects and the critic — feedback may mix the plans ("A's approach with B's data model").

```
                     Conservative            Bold
Summary              ...                     ...
Score                10/10 · 0 · 1 adv       9/10 · 0 · 2 adv · 1 disp
Scope in / out       ...                     ...
Files new/mod/del    1 / 6 / 0               4 / 11 / 3
Milestones · Size    3 · S                   5 · M
Difficulty           normal                  hard
Requires consent     —                       • extract X into module Y
Top risks            ...                     ...
Reversibility        trivial                 needs migration rollback
Open / disputed      —                       O-B-4 (disputed)
Reframing note       —                       "Y would also cover Z"
Auditor findings     1 → closed              2 → closed
```

Converged plans show as a single column with the convergence note.

**The approved plan is frozen as v1.** Any later change — a major Developer deviation, a QA fix that changes scope — becomes an amendment (v1.1, v1.2…) the user approves, logged on the issue. The diff review always checks against the latest approved version.

On restart, each architect **revises** its previous plan with the user's feedback rather than starting over. Objections already closed stay closed unless the feedback reopens them, and the round cap starts again at 3.

### 6. Developer

- Works on the issue branch, in a dedicated git worktree, following the target repo's branch, commit and PR conventions as the playbook declares them.
- Implements **milestone by milestone**, committing and pushing each one.
- Runs the repo's checks (typecheck, lint, tests — as the playbook declares them) before handing off.
- **Deviation rule:** a minor deviation from the plan is logged; a major one stops work and escalates to the user.

### 7. Diff review

The critic applies its criteria to the **diff against the approved plan and its consent list**: the plan was implemented, nothing beyond it was added, nothing bloated. It also checks the coding standards the playbook points to.

Same ledger format as the architecture loop. A blocking objection sends the work back to the Developer, for at most **2 rounds** (a setting); the Developer may dispute with evidence, and disputes go to the user. Still failing after 2 rounds → escalates to the user.

### 8. QA

**Levels** — `--qa=basic|full|off`, default `basic` (the default is a setting). The user can switch level at the plan pick (`qa full`), once the change is known.

| Level   | Runs                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `basic` | Local dev boot with what any developer already has (no special accounts or secrets); HTTP/CLI only; smoke probes, then the `basic` scenarios; no exploratory pass |
| `full`  | Everything below: every scenario, every driver the playbook declares, exploratory pass                                                                      |
| `off`   | Nothing — explicit choice at start or at the pick only; the PR description states QA was skipped                                                            |

Every acceptance scenario is tagged `basic` or `full` by its architect; the level only selects which scenarios run, so the plan is the same at any level. Every plan has **at least one `basic` scenario that exercises the change** (critic, criterion 7) — otherwise basic QA would only prove the system boots.

**Independence.** QA works from the approved plan, the running system and its runtime logs — never the code, the diff or the Developer's reasoning. It judges behaviour, not wording (outputs may be nondeterministic).

**Preflight.** Before anything boots, the flow checks that the level's drivers are installed, the secrets the playbook names are available, prerequisites are up and ports are free; anything missing is asked of the user in the terminal.

**Boot and teardown.** The main session — not an agent — checks the playbook's prerequisites, starts one instance with the level's start command in the background, and waits on its health command (`skills/motta-heavydev/bin/wait-health.sh`); it costs no model call, and teardown stays in the session's hands even if a QA workflow dies. Scenarios run **sequentially** against it by default; parallel is a setting, allowed only when the playbook declares scenarios independent. **Teardown always runs, even after a failure, and is verified** — `skills/motta-heavydev/bin/teardown.sh` kills the process tree listening on the port and confirms it free (background processes survive a plain stop on Windows).

**Drivers.** Built in: browser (Playwright MCP, installed once per user — it reads the page's structure rather than screenshots; full-level QA runs as the default agent type so it can reach MCP tools), HTTP (curl), CLI (shell), webhook (HTTP plus the playbook's signing recipe). Anything else is declared in the playbook as a custom driver — a command or script in the target repo.

**Per scenario:**

- **Result:** pass · fail · blocked (environment, not code) · flaky. A failure is re-run once (setting): fails twice → _fail_; passes on re-run → _flaky_, which escalates too — an approved scenario that only fails sometimes is a real defect.
- **Evidence:** steps run, what was observed, and screenshots, responses and runtime-log excerpts, saved to the store. QA never captures secrets or personal data; evidence is redacted before it is saved.
- **Caps:** an interaction cap per scenario, since the playbook declares the cost per interaction. A step that would cross a safety boundary is marked _blocked_ and never attempted.

**Exploratory pass** (`full` only). After the scenarios, a bounded pass (step cap is a setting) around the surface the change touched. Its findings are observations, never blocking — except a crash, data loss or a security problem, which escalate.

**Escalation.** QA runs every scenario, then brings **all failures to the user in one batch** — one interruption. A crash that prevents the remaining scenarios escalates at once.

```
QA · S3 "Unauthorised user requests a refund" · FAIL (2/2)
Author: QA-Sonnet-5.5
Expected   ...
Observed   ...
Evidence   <link>
Suspected area   <QA's guess — not a diagnosis>
→ fix | accept | amend-scenario | pause
```

`accept` = the user disagrees with the finding and the flow continues; `amend-scenario` opens a plan amendment. Minor observations are batched into the issue comment.

**After a fix.** The fix goes through the Developer and the diff review; QA re-runs only the failed scenarios. Once everything passes, **one full re-run of every scenario in the level** runs before the PR, to catch what the fix broke (`qa-final-regression`, on by default).

### 9. PR

Opened per the playbook's conventions, linking the issue. The description follows the repo's own PR template plus a **"How this was built"** section: approved plan version and amendments, consent items the user approved, deviations, QA level and results (or "QA skipped"), with links — so a reviewer sees what was agreed without reading the issue. Review and merge are left to the user.

## Checkpoints, pause and resume

The Workflow tool's own resume only works within the same session, so durable resume comes from the flow's own state.

- **Steps.** Every unit of work is a named step with defined inputs and one output artifact (scout brief, architect A round 2, critic verdict round 2, auditor, milestone 3, QA scenario 4…).
- **Self-checkpointing.** A step's last act is to write its artifact and its own **step record** (`steps/<step-id>.json`) and push both to the store. A step is done only when its record exists in the store; one that died mid-way is redone. Developer milestones checkpoint as a pushed commit plus a progress note.
- **No shared mutable state.** Step records are written once and never edited, and parallel steps write disjoint files, so writers never collide. `state.json` is a summary derived from the records, written only by the main session between workflows.
- **Resume.** `/motta-heavydev resume <issue>` rebuilds state from the step records, checks it against reality (branch HEAD, artifacts present) and relaunches the right workflow with the finished steps passed in, which it skips. Works across sessions, days, machines and teammates.
- **Budget.** `--budget=<n>`, measured in **API-equivalent cost** — the four token kinds (uncached input, cache write, cache read, output) weighted per model by a price table in `skills/motta-heavydev/defaults` (editable, taken from Anthropic's published prices). Raw token counts are reported alongside. No `+<n>` shorthand, so the budget can never be confused with Claude Code's own syntax.
  - **Default:** deliberately generous for the first run, then recalibrated from the footer figures of the first runs.
  - **Measured by the main session, between workflows.** A workflow script cannot see real usage (`budget.spent()` counts output tokens only — see [Verified](#verified-phase-0-probe-2026-10-09)), so the main session sums the `usage` of every agent transcript after each workflow returns and keeps the cumulative total in the run's state.
  - **Small workflows** make that check frequent: **one workflow per architecture round, per milestone, per QA batch**. No workflow loops without a bound, so none needs an in-workflow spend check.
  - **Soft warning** at 70%: logged in the terminal and noted on the issue.
  - **Clean pause** when the next workflow could take spending past ~90%: it is not started; the flow writes a pause note and stops.
  - **Unplanned stop** (subscription limit, crash, closed laptop): the per-step checkpoints are the guarantee; if an agent dies, the script starts no new steps and reports where it stopped.
- **Fable is spent only where budgeted.** Every role's instructions forbid calling `advisor` (subagents carry it, backed by Fable). After each workflow the main session scans the transcripts for advisor calls; the footer reports Fable calls, so a breach is visible.
- **Per-agent overhead.** Each role runs as a custom agent type carrying only the tools it needs, to cut the fixed context every agent pays (measured in phase 2). Disabling unused connectors and plugins shrinks it for every session.
- **Step progress.** Every type but `hd-comparator` also lists `mcp__savvy-progress__step`, so a long role can report its own steps to the agents panel; the tool's instructions batch each report with a real tool call, so it adds no turns. The comparator is left out because its task is too short to report on. Without the savvy-progress mod the name is silently dropped and the agent runs as before (checked on 2.1.296).
- **Pause note:** last completed step, step in flight, next step, open objections, branch and HEAD, tokens spent per phase.
- **Time** is tracked by the main session between workflows and recorded in the state; warnings only (scripts cannot read the clock).

## Visibility

Everything happens in the terminal the user started the flow from:

- the workflow progress tree, with a narrator line per step;
- a status line from the main session between phases (phase, step, budget used);
- every request for user input, after which the flow waits — never Slack, email or anywhere else;
- `/motta-heavydev status <issue>` at any time.

## Configuration

Layered, each overriding the previous:

1. built-in defaults (`skills/motta-heavydev/defaults`)
2. the user's personal settings file
3. the target repo's playbook
4. flags on the command

Configurable: store repo, budget, warning and pause thresholds, round cap, model and effort per role, Developer promotion to Opus, auditor on restart, QA level, QA re-runs, scenario parallelism, exploratory step cap, final regression, Q&A logging, plan language, comment verbosity.

## The store repo

Any repo can be the store (`--store`, or the user's default). An empty store gets its layout created on first run. The flow itself lives in the `motta-heavydev` plugin of `l-a-motta/motta-claude-mods`:

```
skills/motta-heavydev/   SKILL.md, defaults.json, bin/ (store writer, sync, usage), roles/, templates/, workflows/
agents/                  hd-*.md — the agent types, loaded by the plugin as motta-heavydev:hd-*
DESIGN.md                this document
```

The default store, `vtex-copilot/motta-heavydev`, holds the runs:

```
playbooks/    <owner>__<repo>.md — one per target repo
runs/         <owner>__<repo>/<issue>/<run-id>/ — state.json, steps/, every artifact
```

**Concurrent writers** — parallel steps in a run, several runs, teammates:

- **One temporary store clone per run**, so different runs never share a working copy.
- **Every write goes through one helper**, `skills/motta-heavydev/bin/store-write.sh`, never through agents running git themselves. It never touches the shared clone's index, HEAD or working tree: each attempt fetches the branch tip into a private ref, builds a commit of that step's paths on a private index, and pushes it, retrying with capped, jittered backoff when another writer wins the race. Files never overlap, so a rebuild always succeeds. `skills/motta-heavydev/bin/test-store-write.sh` proves it with 5 parallel writers in 2 clones (50 files, none lost).
- **One active run per issue.** The run's opening record is the lock and names who started it and on which machine. Starting a run on an issue with an unfinished one is refused ("@leonardo has run 123-1 paused at M3"); the user chooses `resume`, or `--force-new`, which marks the old run abandoned. Anyone may resume a run, but `resume` shows its owner and asks to confirm a takeover.
- **Playbook edits** go through the same helper; a genuine conflict on the same playbook stops the flow and asks the user rather than merging.
- **Repo size.** Evidence is text where possible (responses, log excerpts); screenshots only for failed or flaky scenarios, capped per scenario.

## Playbooks

One per target repo, kept in the store — never in the target repo and never referenced by its docs; it exists only for this flow. Named after the git remote, so any clone or worktree finds it. If a run starts in a repo with no playbook, the flow stops and builds one with the user first.

**What reads it:**

| Role                | Reads                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Scout               | where to start reading; which docs hold the architecture and rules            |
| Architects / Critic | conventions, safety boundaries, coding standards                              |
| Developer           | branch, commit and PR rules; check commands                                   |
| QA                  | how to start the system, sign in, test data, how to drive it, cost per interaction, what it must never touch |
| Flow                | tracker, setting overrides                                                    |

**Format.** Markdown with a YAML header holding what the scripts need; prose sections for the agents. Workflow scripts cannot read files, so the main session reads the header and passes it in as `args`.

```
---
remote, defaultBranch, integrationBranch, tracker, checks{}, boot{}, overrides{}
---
## Where the rules live      pointers to the repo's own docs
## Undocumented knowledge    only what the repo does not already say
## Safety boundaries         required — Developer and QA obey it, the critic checks plans against it
## Running the system        per QA level (basic / full) — prerequisites, start, health check, teardown
## Driving it as a client    per QA level — drivers, smoke probes, where auth comes from, test data, cost per interaction
## Sibling repos             optional — read-only context
```

**Rules:**

- **Points, never copies.** Conventions are referenced in the repo's own docs so the playbook cannot drift from them; it holds only knowledge the repo does not document. A repo without docs simply has a larger "Undocumented knowledge" section.
- **Built draft-first.** The Scout drafts everything derivable from the repo (commands, conventions, boot steps); the user is then interviewed with Matt's `grilling` skill on the gaps only — typically test access, cost limits, off-limits areas, preferences.
- **No secrets, ever.** The playbook names where each secret comes from (env var name, password-manager entry, or "ask me"). Before QA starts, the flow checks they are available and asks the user in the terminal for any that are missing.
- **Safety boundaries are mandatory.** The interview always asks for them explicitly, even if the answer is "none".
- **Kept current by the Scout.** Each run's Scout checks the playbook (do its commands and the docs it points to still exist?) and proposes fixes, which the user approves at the plan pick. The flow never edits a playbook on its own.
- **One target repo per run.** Sibling repos may be read by the Scout and booted by QA, but nothing outside the target repo is written. A plan that needs changes elsewhere lists them under "Requires your consent" as follow-up work.
- **GitHub Issues only**, declared through `tracker` so other trackers can be added later without redesign.

## Issue log

- **One comment per phase:** Intent · Architecture · Plan pick · Implementation · Diff review · QA · PR. Pauses, resumes, amendments and escalations are recorded inside the comment of the phase they happen in.
- **Created when the phase starts, edited as it progresses**, with a status line on top (`running · round 2/3`, `paused at M3`, `done`). GitHub notifies watchers only on creation, so watchers get one notification per phase; the full history lives in the store's git log.
- **Readable without the links.** Each comment summarises the outcome and decisions on its own and links the full artifacts in the store, so teammates without store access can still follow it.
- **Per-section authorship.** Each section carries its author stamp; the header lists every role that contributed.
- **Footer:** run id, tokens and time per phase, link to `state.json`.
- **Status and board moves only when the playbook declares the rules** (for vtex-copilot-fse, `.github/BOARD.md`); otherwise the flow only comments.
- Same redaction rules as everywhere: no secrets or personal data.

```
### motta-heavydev · Architecture · run 123-1
Status: done · 2 rounds · converged: no
Authors: Architect-Conservative-Opus-5.5, Architect-Bold-Opus-5.5,
         Critic-Opus-5.5, Auditor-Fable-5.1, Comparator-Sonnet-5.5

#### Comparison                         Author: Comparator-Sonnet-5.5
<the side-by-side table>

#### Audit                              Author: Auditor-Fable-5.1
2 findings → both closed in round 2 (O-B-5, O-C-3)

<details><summary>Round log</summary>
Round 1 — Conservative 8/10 ✗ 5 Complete — CSV export not covered …
Round 2 — …
</details>

Artifacts: plans · ledger · brief · audit
—
run 123-1 · architecture 412k tokens · 18 min · state.json
```

## Distribution

A Claude Code plugin in the `motta-claude-mods` marketplace: `claude plugin install motta-heavydev@motta-claude-mods`. It brings the skill and the agent types together, so nothing is linked or copied by hand. Teammates without that marketplace copy `skills/motta-heavydev/` into `~/.claude/skills/` and `agents/` into `~/.claude/agents/`, and then set each role's `agentType` to the bare `hd-*` name.

## Verified (phase 0 probe, 2026-10-09)

Probe: one workflow, 7 agents, run from a vtex-copilot-fse session.

- **Per-agent model selection works.** `model: 'sonnet' | 'opus' | 'fable' | 'haiku'` reached `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`, `claude-haiku-5-5` (checked in the agent transcripts, not self-reported).
- **Manual-only gating holds.** A skill with `disable-model-invocation: true` is absent from both the main model's and a subagent's skill list, and the Skill tool refuses it: _"cannot be used with Skill tool due to disable-model-invocation. Ask the user to run /… themselves"_. The control skill without the flag was listed and invoked.
- **`budget.spent()` counts output tokens only, shared with the main loop.** With no `+<n>` directive `budget.total` is `null` and `spent()` still works (it started at ~87k — the main session's own output). The 7 agents added **657** output tokens to it while the workflow's usage report showed **375,085** subagent tokens in total. Output tokens badly under-measure consumption.
- **Each agent carries ~47k tokens of fixed context** (system prompt, CLAUDE.md, memory, skill and tool listings) in this repo, written to cache fresh on every call.
- **Prompt cache is not shared across agents.** Two Opus agents with an identical ~15k-token brief each re-wrote ~57k tokens of cache and read back only ~11.6k (a shared prefix ending before the brief). Within a single agent's conversation, later turns do read the cache (~47k read on turn 2).
- **Subagents carry the advisor tool, backed by Fable** (`advisorModel: claude-fable-5-1` on every agent request). An agent that calls `advisor()` spends Fable outside the one budgeted audit call.
- **A typed `+200K` in a user message did not set a workflow ceiling** — `budget.total` stayed `null`.
- **Custom agent types load only at session start.** One created mid-session is "not found"; the workflows fall back to the default agent and log it.
- **Custom agent types cut the fixed context by ~60%.** Measured after a restart, same model: default workflow agent 46.2k tokens, `hd-critic` 18.1k, `hd-comparator` 16.5k. Every role runs as an `hd-*` type.

## Verified (architecture smoke test, 2026-10-09)

A synthetic issue ("add `--dry-run` to `store-write.sh`") against this repo, with a scratch local store: scout, round 1 (both briefs), a forced round 2 with restart feedback, audit (Sonnet as a stand-in for Fable), compare.

- **The mechanics hold end to end.** Every step published its artifact and step record through `store-write.sh`, including two workflows writing to the same clone at once. The critics verified plan claims against the code with `path:line` evidence and raised real advisory objections; in round 2 the architect responded to each, the critic carried both objections and closed them with closing evidence, and the computed score moved from `2 advisory` to `0 advisory`. No agent called `advisor`.
- **The main session needs `store-sync.sh` between workflows** — the writers publish without moving the clone's HEAD, so a plain `git pull` refuses.
- **Usage is dominated by cache reads.** Each agent re-reads its whole context on every tool call: the 8 agents wrote ~520k tokens to cache, read ~3.2M from it and produced ~76k output. Opus architect and critic calls ran ~60–70k cache write and ~350–520k cache read each.
- **The workflow's own usage report leaves cache reads out** (round 1: 286k reported, against ~309k cache write + output and ~1.7M cache read). `skills/motta-heavydev/bin/usage.mjs` reads the transcripts and is the measure the budget uses.

## Verified (implementation smoke test, 2026-10-09)

The approved conservative `--dry-run` plan from the architecture smoke test, implemented in a worktree of a scratch clone whose `origin` is a local bare repo, then reviewed and QA'd at the basic level.

- **Developer** (Sonnet, `hd-developer`): M1 and M2 each committed, pushed to the scratch origin and left the playbook's checks green; code and test landed in separate conventional commits; on the final milestone it ran every check and proved check 5 can fail by mutating the script in a temp copy. Both milestones logged the same genuine minor deviation — a stale path in the playbook — rather than silently working around it.
- **Diff review** (Opus, `hd-critic`): `9/9 pass · 0 blocking · 1 advisory`, every criterion argued from `path:line`; it judged the logged deviation minor and said plainly that it had not run the tests itself (read-only role).
- **QA** (Sonnet, `hd-qa`, basic): S1–S4 passed with evidence files in the store; nothing to escalate.
- **Cost** at API-equivalent prices: M1 $0.34, M2 $0.18, diff review $0.41, four QA scenarios $0.40 — about **$1.33** for the second half; the playbook draft of vtex-copilot-fse cost $0.28. No agent called `advisor`.
- **Not yet exercised:** fix mode (a failing diff review or QA finding sent back to the Developer), QA failure, flaky and halt classification, full-level QA with a browser driver, booting a real system, the PR step, and the main session following `SKILL.md` end to end — the first real run covers the last of these.

## To verify while building

Assumptions the design rests on that must be tested, not trusted:

- Playwright MCP covers the browser driver on Windows.
- What `agent()` returns when an agent dies — handle both `null` and a throw.
