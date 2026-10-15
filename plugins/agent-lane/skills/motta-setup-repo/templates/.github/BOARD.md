# Delivery board playbook

How to create, classify, and update issues on the [delivery board](https://github.com/orgs/{{OWNER}}/projects/{{PROJECT_NUMBER}})
(GitHub Projects v2, org `{{OWNER}}`, project number **{{PROJECT_NUMBER}}**, linked to `{{OWNER}}/{{REPO}}`).
This document is the complete reference — a session with no prior context must be able to do board
work correctly using only this file plus `AGENTS.md`.

**Single source of truth:** classification lives in the **board fields** (Status, Priority, Size,
Area, Target) and the **GitHub issue Type**. Repo labels do NOT mirror them — only `type:` labels
exist (they drive form routing), plus `needs-triage`, `breaking-change`, `blocked`, `superseded`,
the agent-lane labels (`agent: ready`, `agent: needs-human`, `agent: review`, `agent: human-approved` — see "Agent lane")
and generic GitHub defaults. Never create `prio:` or `area:` labels; they were deliberately removed.

## Issue anatomy

Every issue carries ALL of the following. The issue forms (`.github/ISSUE_TEMPLATE/`) handle the
first four when a human files via the UI; anything created via `gh` must set them explicitly.

| Kind    | Title prefix | Issue Type                         | Label           | Form          |
| ------- | ------------ | ---------------------------------- | --------------- | ------------- |
| Feature | `feat: `     | Feature                            | `type: feature` | `feature.yml` |
| Bug     | `fix: `      | Bug                                | `type: bug`     | `bug.yml`     |
| Chore   | `chore: `    | Task                               | `type: chore`   | `chore.yml`   |
| Spike   | `spike: `    | Task                               | `type: spike`   | `spike.yml`   |
| Epic    | `epic: `     | Feature (no Epic type — free plan) | `type: epic`    | `epic.yml`    |

Plus, on the board: **Status**, **Priority**, **Size** (not for epics), **Area**, optionally
**Target** and a **milestone**, and **assignees** — every person actively working on it (see PR
lifecycle, step 1). Titles after the prefix are
lowercase, imperative, like commit subjects: `feat: add <the artifact it delivers>`.

## Field semantics

- **Status** — `Backlog` (not committed) → `Todo` (committed, up next) → `In Progress` →
  `In Review` (PR open) → `Approved` (PR approved) → `Done` (set automatically when the issue closes, i.e. its feature PR merges
  into `dev` — see PR lifecycle) → `Released` (the work has shipped to `main` via a `dev` → `main`
  release PR). `Done` means "merged to `dev`, awaiting release"; `Released` means "in `main`".
  `Closed` is an off-flow terminal state for issues resolved **without any associated code change**
  — e.g. a spike that concluded, or an investigation/settlement that ended with no development
  update — distinct from `Done`/`Released`, which both imply merged work. Both terminal states end
  in the board **archive** — see "Archiving" in the PR lifecycle for the timing and the
  connected-issue check. `Blocked` is off-flow too: the work cannot move until something outside
  it arrives — another team's change, a vendor, an upstream fix, or a person's answer to an
  agent's question (`agent: needs-human`). Say what it waits on in a comment, and move it back to
  `Todo` or `In Progress` once that arrives.
- **Priority** — `P0`: breaks production or deploys, drop everything (rare — don't inflate).
  `P1`: current-wave roadmap work, user-impacting. `P2`: scheduled but deferrable.
  `P3`: not prioritized yet — captured and ranked low, may need revision before anyone picks it
  up. `Deferred`: deliberately not being done for now (e.g. another initiative will cover it); the
  issue stays open as the record of the case and its evidence. Use `Deferred`, not `Closed`,
  while the problem is still real — `Closed` is for issues resolved with no code change.
- **Size** — `XS`: trivial edit. `S`: cookie-cutter copy-adapt (one more instance of an existing
  pattern). `M`: new logic. `L`: cross-layer feature.
  `XL`: epic-scale — split it instead of filing it.
- **Area** — one of: {{AREA_LIST}}. The list mirrors the layers in `{{DESIGN_DOC}}`; if a new area is truly
  needed, add it to BOTH the board field and every form's Area dropdown in the same change.
- **Target** — per-issue planned date (drives the roadmap view). Distinct from milestones:
  the milestone due date is the hard external commitment; Target is the plan. Targets landing
  after the milestone due date = early warning.
- **Milestone** — repo-level, one per issue max. Wave milestones (e.g. "Wave 1 Workflows
  Completed") group a date-bound cut across epics; monthly milestones ("2026-06 Deliveries")
  catch date-committed work outside a wave. List them: `gh api repos/{{OWNER}}/{{REPO}}/milestones`.

### Epic rules

- Epics get Priority, Area, Target, and the `type: epic` label — but **no Size** (children carry
  the estimate) and **no milestone** (children belong to milestones; an epic in a milestone would
  double-count the progress bar).
- Children are attached as **sub-issues** (see below); the board's _Sub-issues progress_ field
  then tracks completion automatically. An epic's body lists planned children and the shared
  delivery pattern (see `epic.yml`).
- Epic priority = max of its children's priorities (`P0` > `P1` > `P2` > `P3`; `Deferred`
  children don't count).

## Before creating: check for duplicates

Before filing **any** issue (web UI or `gh`), do a quick **duplicate scan** so the same case/idea
doesn't get fragmented across multiple issues:

- List existing issue **titles**, open _and_ closed (a closed one may already track the idea — or
  show it was rejected):
  `gh issue list --repo {{OWNER}}/{{REPO}} --state all --limit 300 --json number,title,state`.
  **Skim titles only** — a full read of every issue is _not_ expected.
- Only when a title makes you **suspect** the same case/idea is already tracked, **read that issue's
  body** to confirm before deciding.
- If a match exists: comment on / extend the existing issue (or attach as a sub-issue, or
  cross-link) instead of opening a duplicate. If the new issue is genuinely distinct, say briefly
  how it differs in its "Additional context" and link the related one (`#<n>`).

## Creating an issue from the CLI

Issue forms only run in the web UI. From `gh`, replicate everything:

```bash
# 1. Create — body must mirror the matching form's section headings (### Problem / opportunity,
#    ### Proposed solution, ### Acceptance criteria, ### Area, ...) so issues read identically.
#    Write multiline bodies to a temp file; don't inline them.
gh issue create --repo {{OWNER}}/{{REPO}} \
  --title "feat: add <thing>" \
  --body-file /tmp/body.md \
  --label "type: feature,needs-triage" \
  --assignee <login>

# 2. Set the GitHub issue Type (forms do this via their `type:` key; gh create cannot)
gh api repos/{{OWNER}}/{{REPO}}/issues/<n> -X PATCH -f type=Feature   # Feature|Bug|Task

# 3. Add to the board (forms do this via their `projects:` key)
gh project item-add {{PROJECT_NUMBER}} --owner {{OWNER}} --url <issue-url>

# 4. Set board fields (next section)

# 5. Milestone, when date-bound
gh issue edit <n> --repo {{OWNER}}/{{REPO}} --milestone "<title>"
```

## Setting board fields (GraphQL)

Stable IDs (project + fields — re-verify with the lookup below if a mutation 404s):

| Thing               | ID                               |
| ------------------- | -------------------------------- |
| Project             | `{{PROJECT_ID}}`           |
| Status field        | `{{STATUS_FIELD_ID}}` |
| Priority field      | `{{PRIORITY_FIELD_ID}}` |
| Size field          | `{{SIZE_FIELD_ID}}` |
| Area field          | `{{AREA_FIELD_ID}}` |
| Target field (date) | `{{TARGET_FIELD_ID}}`   |

`.github/scripts/board.sh set <issue> <Field> "<Option>"` does every lookup below and the
mutation in one call (and `board.sh get <issue>` prints the current values); reach for the raw
queries only for fields it does not cover, such as Target.

**Option IDs are NOT stable** — always fetch them by name at runtime, plus the item ID:

```bash
# Option IDs for all single-select fields
gh api graphql -f query='query { organization(login: "{{OWNER}}") { projectV2(number: {{PROJECT_NUMBER}}) {
  fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }'

# Item ID for an issue already on the board (through the issue: the board outgrew one page)
gh api graphql -f query='query { repository(owner: "{{OWNER}}", name: "{{REPO}}") {
  issue(number: <n>) { projectItems(first: 20) { nodes { id project { number } } } } } }'
```

Then set values:

```bash
# Single-select (Status / Priority / Size / Area)
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {
  projectId: "{{PROJECT_ID}}", itemId: "<ITEM_ID>", fieldId: "<FIELD_ID>",
  value: {singleSelectOptionId: "<OPTION_ID>"}}) { projectV2Item { id } } }'

# Date (Target)
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {
  projectId: "{{PROJECT_ID}}", itemId: "<ITEM_ID>", fieldId: "{{TARGET_FIELD_ID}}",
  value: {date: "YYYY-MM-DD"}}) { projectV2Item { id } } }'
```

> ⚠️ **Never rewrite a single-select field's option list via the API.** `updateProjectV2Field` with
> `singleSelectOptions` REGENERATES every option ID and silently WIPES that field's value on all
> items (no name-matching — confirmed the hard way on the FSE board on 2026-06-24: adding one
> `Status` option blanked all 81 items). **To add/rename/reorder an option, use the Projects UI** (Project → ⋯ → Settings →
> the field → **+ Add option**), which preserves existing options and item values. If you _must_ use
> the API, snapshot every item's value first (`fieldValueByName`) and restore each afterward.

## Sub-issues (attaching children to an epic)

The REST endpoint takes the child's **database ID**, not its number:

```bash
CHILD_ID=$(gh api repos/{{OWNER}}/{{REPO}}/issues/<child-number> --jq .id)
gh api repos/{{OWNER}}/{{REPO}}/issues/<epic-number>/sub_issues -X POST -F sub_issue_id=$CHILD_ID
```

Filtering caveat: on the board, `parent-issue:"...#<n>"` matches the **children** (their Parent
issue field), never the epic itself — epics have an empty Parent issue field. To see hierarchy,
_group_ views by Parent issue instead of filtering.

## PR lifecycle — updating issues as work ships

Branch → PR → merge keeps the board honest. **Work collects on `dev`; `main` is the released
branch.** Feature branches merge into `dev`; `main` only receives a periodic, tech-lead-reviewed
**`dev` → `main` release PR** (≈ a week's worth at a time). The expectations:

1. **Starting work** — the same three moves, in this order, every time, before any code:
   **(a)** read the issue (and this playbook); **(b)** **add yourself as an assignee with your
   GitHub account — additively**
   (`gh issue edit <n> --repo {{OWNER}}/{{REPO}} --add-assignee @me`): never remove or
   replace anyone already assigned — the assignee list is how the board tracks who is working on
   what, and several people may legitimately be on one issue; **(c)** set the issue's Status to
   `In Progress`. An issue that is `In Progress` with nobody assigned, or being worked by someone
   not on its assignee list, is a process bug — fix it when you see it.
   Then branch off **`dev`** with the matching typed prefix (`feat/`, `fix/`, `chore/`, `docs/`,
   `refactor/`). **When the work is tracked by an issue, the issue number must lead the branch
   slug, right after the type prefix:** `feat/219-group-authentication`,
   `fix/174-group-delivery-and-batch`. The type prefix always stays first so branches still group
   by kind; the number gives instant issue↔branch traceability across every board item and lets
   GitHub auto-suggest the link. (Untracked trivial work with no issue — the rare exception — keeps
   the plain `type/topic` form, but file an issue first when in doubt: work should be tracked before
   it merges.) Create the branch with `gh issue develop <n> --base dev --name <branch>` so it is
   **natively linked** to the issue (it shows under the issue's _Development_ section), not merely
   named after it — see "Linking issues and branches" below.
2. **Opening the PR**: target **`dev`** as the base. Fill `.github/pull_request_template.md`
   honestly. The `Closes #<n>` line is **mandatory** — it **links** the PR to the issue (it appears
   in the issue's _Development_ section). Note it does **not** auto-close the issue on the `dev`
   merge: GitHub's closing keywords only fire when a PR merges into the repo's **default branch**
   (`main`), so on a `dev` merge you close the issue **manually** (see step 3). One PR may reference
   several issues (`Closes #26, closes #27`). Set the issue's Status to `In Review`. When the PR
   receives an approving review — or, on a PR opened under the approver's own account, which
   GitHub does not let them approve, the `agent: human-approved` label — set the issue's Status to
   `Approved`. Sub-issue
   completion rolls up to the epic automatically; when the last child closes, close the epic too.
3. **Merging to `dev`**: merge feature PRs with **"Squash and merge"** — the feature branch is
   deleted afterwards, so collapsing its commits into one is a pure win for `dev`'s history.
   `Closes #` does **not** auto-close the issue here (the default branch is
   `main`, not `dev`). Close the issue **manually** after merging — with a comment pointing at the
   PR — and set its Status to `Done`. `Done` = merged to `dev`, awaiting release. (Empirically the
   linked issues are closed by a maintainer within seconds of the merge, which reads as automatic but
   is not — a keyword auto-close would record the PR as the issue's `closer`; ours show `closer: null`
   with a human actor.)
4. **Releasing (`dev` → `main`)**: the tech lead opens one batch PR from `dev` into `main`, reviews
   the accumulated work, and merges **with "Create a merge commit" — NEVER "Squash and merge"**.
   `dev` and `main` both live forever: squashing a release creates a commit on `main` that `dev`
   has no ancestry link to, so the branches silently diverge and the **next** release PR re-lists
   every already-released commit and reports phantom conflicts (this bit vtex-copilot-fse on its #330
   after the #317 release was squashed, and took an ancestry-only back-merge to repair). A merge commit makes
   `main`'s tip a shared ancestor of both branches automatically — nothing to remember afterwards.
   GitHub's merge-method settings are repo-wide, not per-branch, so this rule is enforced here, by
   the tech lead's click. It carries **no `Closes #`** lines (those issues already closed
   on the `dev` merge). After it ships, move the released issues' Status from `Done` to `Released`.
   - **`breaking-change` label — the release PR must call it out.** An issue (and its feature PR)
     carries the `breaking-change` label when the change is important history or possibly breaking:
     it removes an integration, changes what leaves the platform, alters auth, or is something we
     would need to find fast if production misbehaves afterwards (e.g. changing which channel an
     irreversible Action goes out on, or adding a data source). Before opening a release PR, list them:
     `gh issue list --repo {{OWNER}}/{{REPO}} --label breaking-change --state all --search "closed:>=<last-release-date>"`.
     The release PR body **MUST** open with an `⚠️ IMPORTANT / POSSIBLY BREAKING` block naming each
     such issue, what it removes or changes, how to detect a regression, and how to roll back —
     and the PR **requires explicit human review** (a person reads that block and approves; no
     self-merge, no auto-merge). A release PR that carries a `breaking-change` issue without that
     block is malformed — fix the body before merging. Labelled issues are also **pinned** on the
     repo while the change is recent, so the history is one click away from the Issues tab.
5. **Archiving**: the live board holds open work only — terminal items leave it through the
   project **archive** (Project → item ⋯ → _Archive_, or `archiveProjectV2Item`). Archived items
   stay searchable and keep every field value, but GitHub refuses field updates on them (unarchive
   → update → re-archive if you must correct one).
   - **`Released` issues are archived 24h after their actual release** (the `dev` → `main` merge
     that carried them). No warning is needed, even when other issues will build on them — the
     shipped code and the PR are the durable reference, not the board card.
   - **`Closed` issues may stay on the board indefinitely** when other issues rely on them:
     another issue references them, is connected to their conclusion, or depends on information
     they hold (a spike's findings, a settled decision, an investigation's evidence). An
     **independent** `Closed` issue — nothing links to or builds on it — is archived 24h after
     closing, like a released one.
   - **Before archiving a `Closed` issue, always check its connections and notify the user** when
     any exist (cross-references from other issues, sub-issue/epic links, `Closes`/`Refs` mentions,
     board items pointing at it) — the user decides whether it stays. Released issues never need
     this warning.

### Recovering from a squashed release or a deleted `dev`

The repo's plan has no branch protection, so the step-4 rule is enforced only by the click. It
has been broken more than once — a release squash-merged **and** `dev` deleted afterwards.
Symptoms: `git fetch origin dev` finds no remote ref; open PRs show an
`automatic_base_change_succeeded` event in their timeline and now target `main`; the next
release PR re-lists already-released commits or reports phantom conflicts. Recovery:

1. Confirm the content is identical: `git diff origin/main dev --stat` is empty.
2. On local `dev`, record the ancestry with no file changes:
   `git merge -s ours origin/main -m "Merge origin/main into dev: reconcile the #<release> release squash"`.
3. `git push -u origin dev`, then verify `git merge-base --is-ancestor origin/main origin/dev`.
4. Find every PR GitHub retargeted (`gh api repos/{{OWNER}}/{{REPO}}/issues/<n>/timeline`,
   event `automatic_base_change_succeeded`) and move it back with `gh pr edit <n> --base dev`.

After any release, check that `dev` still exists (`git ls-remote --heads origin dev`) and that
the release merge commit has two parents.

**Stacked PRs.** Merging a PR **and deleting its branch** auto-closes (does not retarget) any PR
stacked on that branch, and a closed PR cannot be reopened once its base is gone. Retarget the
upper PR (`gh pr edit <upper> --base dev`) **before** deleting the lower branch; if one did get
closed, open a fresh PR carrying the same `Closes #<n>`. `git merge-tree --write-tree --name-only

<base> <branch>` forecasts conflicts without touching anything.

**Board sweep.** Status does not always follow an issue's closing. After a merge wave, list the
closed issues whose Status is not `Done`/`Released`/`Closed` and fix them.

### Linking issues and branches

Connect every branch to its issue via GitHub's **native issue↔branch link** (the issue's
_Development_ section), not just a matching name. Always check for an existing connection before
creating a duplicate — in **both** directions:

- **Created an issue? Check for an existing branch first.** `gh issue develop <n> --list` shows
  branches already linked to the issue; also scan for a topic-matching branch
  (`git branch -a | grep <topic>`). If one exists, use/link it; otherwise create **and** link in one
  step with `gh issue develop <n> --base dev --name <branch>`.
- **Created a branch? Check for an issue it would solve first.** Match it to an open issue using the
  signals in "Finding which issue a PR solves" below (branch topic, changed files, commit scopes).
  If a matching issue exists, link it; if none does, file the issue first (work should be tracked
  before it merges) — prefer recreating the branch via `gh issue develop` so the link is native.
  (`gh issue develop` creates linked branches; retro-linking an already-pushed branch is done from
  the issue's _Development_ section in the GitHub UI.)
- **Session started on an app-made `claude/*` branch? It is scratch only.** The Claude desktop
  app gives each session a worktree branch named `claude/<session-title>-<hash>` before any rule
  here is read, cut from whatever the main checkout has checked out (which can be `main`). No app
  setting can make it follow this playbook: its prefix is one fixed word for every repo. Never push
  it or open a PR from it — the app's _Create PR_ button and `git push -u origin HEAD` both publish
  whatever is checked out. Before the first push, create the real branch with
  `gh issue develop <n> --base dev --name <type>/<n>-<topic>`, switch to it, and cherry-pick only
  the session's own commits (`git log --oneline <scratch> --not origin/dev origin/main` lists them).
  When the work is done, tell the user which scratch branches the session left behind and offer to
  delete them (`git branch -D`; skip one still checked out in a live worktree), so they don't pile up.
- **Opened a PR? Attach it to its issue — every time.** A linked branch does **not** link the PR;
  the `Closes #<n>` keyword in the PR body is what ties them together. On a PR targeting `dev` it
  registers as a **timeline cross-reference**, not a closing link: GitHub creates the closing
  reference (and the _Development_-section entry) only for PRs targeting the default branch
  (`main`) — measured on vtex-copilot-fse#290 and #297, both of which show `closingIssuesReferences: 0` with the
  keyword present and correct. So do **not** treat an empty _Development_ section as a malformed
  keyword on a `dev` PR; verify the link by finding the PR in the issue's timeline instead.
  Whenever you open a PR, determine which issue it solves (see "Finding which issue a PR solves"
  below) and put the `Closes #<n>` line in the body. In this flow it never auto-closes anything —
  the `dev` merge is closed manually (step 3) and the release PR carries no keywords (step 4) — but
  it is what records intent, what puts the PR in the issue's timeline, and what a reviewer follows.
  Write it exactly: `closes#5`, `ref #5`, or the wrong number all fail to register. If a PR
  genuinely solves no tracked issue, file one first — work should not merge untracked.

The native link is for traceability and navigation; the `Closes #<n>` line in the PR body is what
associates the PR with the issue — a timeline cross-reference on a `dev` PR, which is every feature
PR here. Every PR needs it, and on a `dev` merge you still close the issue manually.

### Finding which issue a PR solves

When asked to open a PR (or "which issue did I just solve?"), don't guess — match the diff to the
board:

```bash
gh issue list --repo {{OWNER}}/{{REPO}} --state open \
  --json number,title,labels --limit 100
```

Match signals, in order of strength:

- **New/changed files ↔ issue title**: a new file named after its artifact ↔
  `feat: add <that artifact>`. Most issues are named after the artifact they produce,
  so this is usually decisive.
- **Branch name** topic and commit-message scopes.
- **Epic delivery patterns**: each epic's body says exactly what a child delivers (file paths,
  registration points) — use it to disambiguate.

Suggest the match (with the issue number and title) before writing `Closes #` — confirm rather
than assume when more than one candidate fits. If genuinely nothing matches, say so and offer to
file a new issue first (work should not merge without a tracked issue).

## Agent lane — from spike to merged PR

Feature work can run unattended: a person settles the decisions up front, an agent session builds
the issue in its own branch and worktree, and a person approves the PR from its product summary
without reading the code. The lane uses the same Status flow and PR lifecycle as everything else;
four labels carry the hand-offs, all named `agent: …`. The skills of the `agent-lane` plugin carry
out each stage: `motta-intake`, `motta-settle-spike`, `motta-dispatch` (starts the build runs from the
desktop app), `motta-build-issue`, `motta-ship-pr`, and `motta-review` for the review loop. The plugin
lives in the `motta-claude-mods` marketplace and is installed at user scope
(`claude plugin install agent-lane@motta-claude-mods --scope user`); it works on whichever repo it runs
in and takes every repo-specific rule from this file, the scripts in `.github/scripts/` and `AGENTS.md`.
Invoke its skills as `/agent-lane:<skill>`, e.g. `/agent-lane:motta-intake`.

| Label                   | On          | Applied by                                                | Means                                                                          |
| ----------------------- | ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `agent: ready`          | issue       | the tech lead (by convention — GitHub cannot restrict it) | meets the agent-ready bar below; a run may be started on it                    |
| `agent: needs-human`    | issue or PR | an agent run or review                                    | it stopped on a question; the question is the latest comment                   |
| `agent: review`         | issue or PR | a person, after leaving comments (or none, for a review)  | a review session answers and acts on every unanswered human comment            |
| `agent: human-approved` | PR          | an owner who read the PR's Product summary                | the ship step may merge it once CI is green; the issue's Status is `Approved`  |

### Stages

1. **Intake** — a new need (a stakeholder conversation, a user case, an incident) becomes a
   `spike:` issue from `spike.yml`, after the duplicate scan, with who asked and what they said in
   its Context field.
2. **Settle** — a person, usually with an assistant session, answers the spike's question and
   fills its Settlement fields in the issue body: numbered decisions, rejected options, the feature
   issues, human-only steps, breaking change. Each feature issue is filed from `feature.yml`,
   attached as a **sub-issue** of the spike, and carries the decisions it depends on. Once they are
   filed the spike is `Closed` — its code ships on the feature issues. Issues that meet the bar
   below get `agent: ready`.
3. **Build** — one run per `agent: ready` issue, any number in parallel, each in its own worktree
   and branch. A run removes `agent: ready` as it starts (so no second run picks the issue up),
   then follows the PR lifecycle above exactly: assignee, `In Progress`, a `gh issue develop`
   branch off `dev`, a PR into `dev` from the template, `In Review`. It keeps pushing fixes until
   CI is green. Runs open PRs under the account of the person who started them.
4. **Ship** — a person reads the PR's Product summary and applies `agent: human-approved`. The
   `agent-lane` workflow (`.github/workflows/agent-lane.yml`) then runs the ship step,
   `.github/scripts/ship-pr.mjs` — `motta-ship-pr` runs the same script by hand. It checks the
   gates: base `dev`, not a draft, the approval newer than the head commit, no open before-merge
   human step, no open `agent: review` or `agent: needs-human` label, a `Closes #` line, every CI check passed (it waits up to 30 minutes; `dev` has no
   branch protection, so nothing else enforces this), and no conflicts. Then it sets `Approved`,
   squash-merges pinned to the approved commit, deletes the branch, closes each linked issue with
   a comment and sets it `Done`, closes a parent whose sub-issues are now all closed, and adds the
   PR's row and after-release items to the open `dev` → `main` release PR. At a failed gate it
   comments which gate failed and how to clear it, and merges nothing.

   **The workflow's setup:** the repo variable `AGENT_LANE_OWNERS` lists the GitHub logins whose
   label ships (comma-separated; while it is unset, no label ships anything), and the secret
   `BOARD_TOKEN` is a token with read/write on the org's Projects (without it the merge still
   happens but the board stays as it was). A push after the approval removes `agent: human-approved`,
   so an approval always covers the commits it saw. The workflow runs from the base branch's copy
   (`pull_request_target`), so a PR never ships under the gates it changes itself.

**Review, at any stage.** To have an agent act on feedback, comment on the issue or PR — a change
to make, a question to answer — and label it `agent: review`. `/agent-lane:motta-review` starts one side
session per labelled item. Each session makes the requested changes (code on the PR's branch, or an
edit to the issue), replies to every human comment saying what it did or answering it, and removes
the label. A comment that needs an owner's decision gets `agent: needs-human` instead. Agent
replies open with a hidden `<!-- agent-lane:reply to=<comment id> -->` marker — agents post under
the owner's account, so the marker is how a later review tells answered comments from open ones.
With no comments to answer, the session reviews the item and posts its findings.

### The agent-ready bar

Apply `agent: ready` only when all of these hold:

- Product impact, Decisions, Out of scope and Acceptance criteria are filled, and no open question
  remains in the body or the comments.
- Every acceptance criterion can be checked by a test or a stated observation.
- Human-only steps is filled — "None" counts.
- Breaking change is decided, and the `breaking-change` label matches it.
- Size is `XS`, `S` or `M`. Split `L` work into smaller issues first.

### Rules for an agent run

- **Never guess.** When the issue does not settle a product or architecture call the work needs,
  the run comments the question on the issue (the options and its recommendation), adds
  `agent: needs-human`, sets `Blocked`, and stops. A person answers in the issue — editing its
  Decisions — removes the label and applies `agent: ready` again.
- **Report every deviation.** Any call the issue did not settle, or settled differently, goes in
  the PR under "Deviations from the issue".
- **Build what it can, list what it cannot.** Human-only steps don't stop the build; the run lists
  them under "What a human must do" in the PR.
- **Stay in the lane.** Never push to `dev` or `main`, never merge its own PR, never touch the
  release PR's merge, a deploy, AWS or SSM, and never write memory files or docs the issue did not
  ask for.

### What the ship step never merges

- A PR whose "What a human must do" still has an open `(before merge)` item. The person who did it
  ticks the item, then applies `agent: human-approved` again. `(after release)` items don't block: the
  ship step carries them into the release PR's after-deploy checklist.
- A `dev` → `main` release PR. The release, its merge commit and the deploy stay with the tech
  lead (PR lifecycle, step 4).

A `breaking-change` feature PR into `dev` may ship on `agent: human-approved` — the label is its explicit
human review. The release PR that carries it still needs its IMPORTANT block and its own review.

## Routine checks

- Issues labelled `needs-triage` are awaiting classification — triaging means: confirm Type +
  title prefix, set Priority/Size/Area, decide Backlog vs Todo, then remove `needs-triage`.
- The board view filters/groupings rely on these fields being complete — an item with empty
  Priority or Area is a process bug; fix it when you see it.
- Assignees are the who-is-working-on-what record: everyone actively working on an issue is on its
  assignee list, added additively (nobody is removed by someone else joining). `In Progress` with no
  assignee is a process bug — the person working it adds themselves.
