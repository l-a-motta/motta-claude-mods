---
name: motta-heavydev
description: Multi-agent flow for large changes, started from an issue — intent interview, two architects and a critic, a single audit, then implementation and QA. Manual only.
argument-hint: "<issue> [--budget=<usd>] [--store=<owner>/<repo>] [--qa=basic|full|off] [--<setting>=<value>] | resume <issue> | status <issue> | playbook [refresh]"
disable-model-invocation: true
---

# /motta-heavydev

You are the **main session** of the flow: you talk to the user, launch the workflows, and keep the run's state. The design behind every rule here is `DESIGN.md` at the root of this plugin (`<skill>/../../DESIGN.md`); when this file and the design disagree, stop and tell the user.

`<skill>` below is this skill's base directory (shown when the skill loads). It contains `bin/`, `roles/`, `templates/`, `workflows/` and `defaults.json`.

## Hard rules

- **Only the user starts or resumes this flow.** Never schedule, loop or auto-resume it; never tell an agent to invoke it.
- **Workflows cannot talk to the user.** Every user interaction happens here, between workflows. A workflow that needs the user ends with `needs-user`; you present it.
- **At a touchpoint, only commands act.** Any other message is a question: answer it, never act on it. A message that reads like a decision is confirmed before anything happens.
- **Author stamps come from configuration**, as `<Role>-<ModelName>` (`modelNames` in the settings). User decisions are stamped `User (@<github-handle>)`.
- **Every store write goes through `<skill>/bin/store-write.sh`**; run `<skill>/bin/store-sync.sh <clone>` after each workflow and before reading the store.
- **Never put secrets, tokens or personal data** in the store, an issue comment or a prompt.

## Interviews

The intent and playbook interviews use the `grilling` skill (from the `mattpocock-skills` plugin). If it isn't installed, run the interview yourself in its format: rounds of numbered questions, each with your recommended answer; ask only questions whose prerequisites are settled; look facts up yourself and ask the user only for decisions; stop when no decision is left and the user confirms.

## Settings

Resolve once per invocation, each layer overriding the previous: `<skill>/defaults.json` → `~/.claude/motta-heavydev.json` (if present) → the playbook's `overrides` → command flags (`--budget=40`, `--qa=full`, `--roundCap=4`, `--auditorOnRestart=false`, …). Echo the non-default values to the user in one line.

## Locating things

- **Target repo:** the git root of the current directory; its key is `<owner>__<repo>` from `git remote get-url origin`.
- **Store:** `--store` or the setting `store`. Clone it once per run to `<tmp>/motta-heavydev/<owner>__<repo>-<issue>` (`<tmp>` from `mktemp -d` / the OS temp dir); reuse it on resume if present, else re-clone.
- **Run directory:** `runs/<owner>__<repo>/<issue>/<run-id>/` with `run-id` = `<issue>-<n>`.
- **Playbook:** `playbooks/<owner>__<repo>.md` in the store.
- **Worktree:** `<parent of target repo>/<repo>-hd-<issue>`, on the issue branch — created at the start of implementation, kept after the run for the user.

## Commands

### `<issue>` — start a run

1. **Preflight.** `gh auth status`; `gh issue view <issue>` succeeds; clone/sync the store. Look for an unfinished run on this issue (`state.json` with status not `done`/`abandoned`): if one exists, stop — tell the user who owns it and where it is paused, and offer `resume <issue>` or `--force-new` (which marks it `abandoned`).
2. **Playbook.** If missing, run [Build a playbook](#build-a-playbook) first, then continue. If present, read it fully; if its tracker conventions point at a doc (e.g. `.github/BOARD.md`), read that before touching the issue.
3. **Open the run.** Write `run.json` (`runId`, owner handle, machine name, start time) and `state.json` (see [State](#state)); publish both.
4. **Intent interview** → [Intent](#intent).
5. **Architecture** → [Architecture](#architecture).
6. **Plan pick** → [Plan pick](#plan-pick).
7. **Implementation** → [Implementation](#implementation).
8. **Diff review** → [Diff review](#diff-review).
9. **QA** → [QA](#qa).
10. **PR** → [PR](#pr). The run is `done`; review and merge are the user's.

### `resume <issue>`

Sync the store, find the unfinished run, show its owner, phase, step and spend. If the owner is someone else, ask the user to confirm the takeover and record it. Rebuild progress from `steps/*.json` (a step is done only if its record exists); check it against reality (artifacts present; for implementation, the branch HEAD). Continue at the first step not done, with the same settings unless the user passes new flags.

### `status <issue>`

Sync the store and print, for the issue's latest run: status, phase, round or milestone, last step, spend against budget, and links to the issue comments. Change nothing.

### `playbook [refresh]`

Run [Build a playbook](#build-a-playbook) for the current repo — `refresh` passes the existing playbook so the drafter keeps what still holds.

## State

`state.json` is written **only by you, between workflows**. Fields: `runId`, `issue`, `target`, `owner`, `status` (`active` · `paused` · `needs-user` · `done` · `abandoned`), `phase`, `round`, `roundsSinceRestart`, `restarts`, `settings` (resolved), `spend` (`total` and per phase, USD), `fableCalls`, `comments` (phase → comment id), `workflows` (each: name, run id, transcript dir, cost, started, finished), `plans` (per brief: plan path, verdict path, pass, score, reframing path), `audited`, `picked`, `planVersion`, `pauseNote`.

## After every workflow

1. `store-sync.sh` the clone.
2. Cost it: `node <skill>/bin/usage.mjs <transcript-dir> <skill>/defaults.json` (the transcript dir is in the Workflow launch result). Add `total.cost` to `spend`; add any `advisorCalls` to `fableCalls` and **tell the user** if one happened outside the audit.
3. Record the workflow in `state.json`, publish it.
4. Edit the phase's issue comment (see [Issue comments](#issue-comments)).
5. Print one status line: `[motta-heavydev #<issue> · <phase> <step> · $<spent> / $<budget> (<pct>%)]`.
6. **Budget.** At ≥ `warnAt` of the budget, say so and note it on the issue (once). Before launching the next workflow, estimate it from the last comparable one; if spending would pass `pauseAt`, don't launch — write a pause note (last step done, next step, open objections, spend per phase), set status `paused`, publish, and stop.

Launch workflows inline: read `<skill>/workflows/<name>.js` and pass its full text as `Workflow({ script, args })`. Never use `scriptPath` — the skill's base directory is not one of the session's directories, so a path launch fails. They run in the background: tell the user what is running, end your turn, and continue when the completion notification arrives. If a workflow returns `null` or an error for a step, retry that workflow once; if it fails again, set `needs-user` and present the failure.

Every `args.run` carries: `storeClone`, `runDir`, `storeWrite` (`<skill>/bin/store-write.sh`), `rolesDir` (`<skill>/roles`), `targetRepo`, `playbookPath` (absolute, in the clone), `intentPath`, `briefPath` (`<runDir>/brief.md`). Each role gets `{ model, effort, agentType, stamp }` from `settings.roles`.

## Build a playbook

1. Run `workflows/playbook-draft.js` with `draftDir: playbooks/drafts/<owner>__<repo>`, `templatePath: <skill>/templates/playbook.md`, the role `settings.roles.drafter` (stamp `Drafter-<Model>`), and, for a refresh, `existingPlaybookPath`.
2. Read `playbook-questions.md`. Interview the user with the `grilling` skill, seeded with those questions and their recommended answers — the safety-boundaries and QA-level questions are always asked.
3. Write the final playbook to `playbooks/<owner>__<repo>.md` **in the shape of `<skill>/templates/playbook.md`**, whatever shape the draft has: YAML frontmatter on the first line with an `author:` key, each prerequisite as `{what, check, fix}`, a `port` for every level that has a `start`. Show it to the user in full and publish it only on their approval.

## Intent

Invoke the `grilling` skill on the issue (title, body, comments) with the playbook in mind. It ends when every decision branch is settled and the user confirms. Then write `intent.md`:

```
Author: User (@<handle>) — interviewed by Session-<Model>
# Intent record — #<issue> <title>
## Need            the user's need, in their terms
## Decisions       every question settled in the interview, with its answer
## Constraints     external constraints and wishes the user stated
## Out of scope
## Assumptions     anything the interview left to the architects, flagged
```

Show it, publish on approval, open the **Intent** issue comment.

## Architecture

Open the **Architecture** issue comment. Run `workflows/scout.js` (role `scout`); show any `playbookIssues` to the user now, and keep proposed playbook fixes for the plan pick.

Then the loop. `pending` = `["conservative", "bold"]`; `previous` = `{}`.

1. Run `workflows/architecture-round.js` with `round`, `plans: pending`, `previous`, `disputeLimit`, the roles `architect` (stamps `Architect-Conservative-<Model>`, `Architect-Bold-<Model>`) and `critic`, plus `feedbackPath` / `auditPath` when they apply to this round.
2. For each result: record plan path, verdict path (`<runDir>/rounds/<n>/verdict-<brief>.json`), `pass`, `score`; set `previous[brief] = { planPath, verdictPath, verdict }`. A result with `droppedAfterRetry` non-empty is reported to the user at the pick. Remove passed plans from `pending`.
3. Stop the loop when `pending` is empty, when `roundsSinceRestart` reaches `roundCap`, or when a round made no progress (same open blocking objection ids as the round before). Plans that did not pass go to the user anyway, with their open objections.
4. **Audit, once per architecture run** (`audited` false, or a restart with `auditorOnRestart`): run `workflows/audit.js` over the plans that passed (role `auditor`, stamp `Auditor-<Model>`). For each plan with findings, put it back in `pending` with `auditPath` and continue the loop within the cap; never call the auditor again in this architecture run.
5. Run `workflows/compare.js` (role `comparator`) with each plan's path, verdict path, score and reframing path, and the audit path.

## Plan pick

Show: the comparison table (`comparison.md`), each plan's score with the short title of every failing criterion, open and disputed objections with both sides' evidence, reframing notes, auditor findings and how each was resolved, the Scout's proposed playbook fixes, and the QA level. Then wait.

**Commands:** `pick conservative` · `pick bold` · `restart: <feedback>` · `qa basic|full|off` · `playbook fixes: accept|reject` · `pause`.

- **Questions** are answered from the artifacts and the repo, stamped `Session-<Model>`. When a question needs the plan author's reasoning, offer a **consult** — one fresh call to that architect (`Agent` with `subagent_type: motta-heavydev:hd-architect`, its plan, the brief and the question), stamped `Architect-<Brief>-<Model> (consult)` — and run it only on the user's yes.
- **Never edit a plan.** If the questions surface a change, draft restart feedback from the conversation; the user confirms or edits it.
- **`restart`** writes `feedback-<k>.md` (stamped `User`), publishes it, and re-enters the loop with every plan in `pending`, `roundsSinceRestart` reset, and a new audit if `auditorOnRestart`.
- **`pick`** copies the chosen plan to `approved-plan-v1.md` under a header recording the decision (stamped `User`, with the QA level and the branch name), publishes it, and writes the **Plan pick** comment with a short summary of the Q&A when `logQa` is on. Show the branch name you will create (from the playbook's tracker conventions, e.g. `feat/<issue>-<slug>`) in the pick summary so the user sees it before picking.

**Amendments.** The approved plan is frozen. Any later change the user decides — a major deviation, a QA scenario change — is written as `approved-plan-v1.<k>.md` with a change log at the top (stamped `User`), published, and noted on the phase's issue comment. Every later workflow gets the latest version.

## Implementation

1. **Branch and worktree.** Follow the playbook's tracker conventions (read the docs they point to). `git -C <target> fetch origin <integrationBranch>`, then `git -C <target> worktree add <worktree> -b <branch> origin/<integrationBranch>`. Record the base commit. Make any board or issue move the conventions require.
2. Open the **Implementation** issue comment.
3. **One workflow per milestone**, in plan order: `workflows/implement.js` with `mode: "milestone"`, the milestone (`final: true` on the last), `approvedPlanPath` (latest version), the earlier notes, `worktree`, `branch`, step `m<k>`, and the role `developer` — model `hardModel` when the plan's difficulty is `hard` — stamped `Developer-<Model>`.
4. On each result:
   - `done` with every check `pass` or `skipped` → next milestone.
   - `done` with a failing check, `blocked`, or `deviation-major` → **touchpoint**: show what the Developer found and the options. Commands: `amend: <decision>` (write the amendment, re-run the milestone), `retry` (re-run as is), `pause`.

## Diff review

1. Open the **Diff review** issue comment. Run `workflows/diff-review.js` with `base` (the recorded base commit), `head` (the branch tip), round 1, the approved plan, role `critic` (stamp `Critic-<Model>`).
2. Not passing → `workflows/implement.js` with `mode: "fix"`, `fixPath` = the verdict, step `fix-review-<k>`; then the next review round with `previous` and the Developer's `responsePath`. At most `diffReviewRounds` rounds.
3. Still not passing, or disputes that reached `disputeLimit` → **touchpoint**: show the open objections with both sides' evidence. Commands: `accept` (continue; noted on the PR), `fix: <instruction>` (one more fix round with the user's instruction added to the fix input), `pause`.

## QA

Level `off` → skip, and say so in the PR. If the playbook has no `start` for the level, skip boot and teardown — QA drives the repo directly. Otherwise:

1. **Preflight**, from the playbook's sections for the level:
   - drivers installed (for a browser driver, ToolSearch for its MCP tools — if absent, stop and tell the user how to install it);
   - each secret's environment variable is set — check with `[ -n "${VAR:-}" ] && echo set || echo missing`, **never print a value**; ask the user for any that is missing;
   - prerequisites: run each check the playbook lists, and only the fixes the playbook allows; anything else goes to the user;
   - the port is free.
2. **Boot.** Start the playbook's start command for the level, in the worktree, with `run_in_background`, its output to `<tmp>/motta-heavydev/<run-id>-qa.log`. Then `bash <skill>/bin/wait-health.sh <qa.healthTimeoutSeconds> <health command>`. Unhealthy → teardown, then **touchpoint** with the log tail.
3. **Run** `workflows/qa.js`, batch `b1`: the scenarios of the level (`basic` runs the `basic`-tagged ones; `full` runs all), role `qa` (or `qaFull` at full level, which can reach MCP drivers), stamp `QA-<Model>`, `interactionCap` for the level, `reruns`, `parallel`, the exploratory settings, the instance's base URL and log file, and the secrets' **sources**.
4. **Teardown — always**, even after a failed or dead workflow: stop the background task and run `bash <skill>/bin/teardown.sh <port>`; it must report the port free.
5. **Escalation** — if the batch returns anything to escalate, one touchpoint for all of it:

   ```
   QA · S3 "<title>" · FAIL (2/2)          Author: QA-<Model>
   Expected   …
   Observed   …
   Evidence   <store link>
   Suspected area   <QA's guess — not a diagnosis>
   ```

   Commands per item: `fix <id>` · `accept <id>` · `amend-scenario <id>: <change>`; also `fix all` and `pause`. Fixes go to `implement.js` in fix mode with a findings file you write (`qa/<batch>/to-fix.json`, stamped `User`), then one diff-review round over the new commits, then a QA batch of the failed scenarios only (boot and teardown again). `amend-scenario` writes an amendment first.
6. When everything passes and `finalRegression` is on, run one **final** batch of every scenario of the level before the PR.

## PR

Open the **PR** issue comment. Push the branch, then open the PR the way the playbook's tracker conventions say (base, title format, template, issue link such as `Closes #<issue>`), with the repo's PR template filled in plus a **"How this was built"** section: approved plan version and amendments, consent items the user approved, deviations, diff-review result, QA level and results (or "QA skipped"), with store links. Make any board move the conventions require. Set status `done`, publish the state, tell the user the PR is theirs to review and merge, and remove the run's temporary store clone.

## Issue comments

One comment per phase — Intent · Architecture · Plan pick · Implementation · Diff review · QA · PR — created when the phase starts (`gh issue comment <issue> --body-file <file>`; the comment id is the number after `#issuecomment-` in the printed URL) and edited as it progresses (`gh api -X PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>`). Format:

```
### motta-heavydev · <Phase> · run <run-id>
Status: <running · round 2/3 | paused at … | done>
Authors: <every role stamp that contributed>

#### <Section>                     Author: <stamp>
<summary readable without the links>

<details><summary>Round log</summary> … </details>

Artifacts: <links to the store files>
—
run <run-id> · <phase> $<cost> · <minutes> min · state.json
```

Store links: `https://github.com/<store>/blob/main/<path>`. Same redaction rules as everywhere.
