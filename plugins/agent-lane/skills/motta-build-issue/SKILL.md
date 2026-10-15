---
name: motta-build-issue
description: "Build one agent-ready issue unattended, from claim to a PR into dev with CI green. Use when told to build, implement or run an issue labelled `agent: ready`, including from a dispatched session."
---

# Build an agent-ready issue, unattended

The third stage of the agent lane (`.github/BOARD.md`, "Agent lane"). Nobody watches this run and
nobody answers mid-run: **the issue is the only source of decisions.** It ends in one of two
states — a PR into `dev` with CI green, or a question on the issue with `agent: needs-human`.
Both are good endings; a PR built on a guess is the bad one.

**The repo is the current checkout.** Its `.github/BOARD.md` is the rulebook for everything below,
and the scripts, issue forms and PR template named here are that checkout's own, under `.github/`.
If the checkout has no `.github/BOARD.md`, stop and say this repo isn't set up for the agent lane.

## The settled line

Implementation detail is yours: naming, file placement, helper shape, test layout — follow the
patterns already in the code. A call is the **owner's** when it changes what a user sees or can
do, what data leaves or enters the platform, auth or permissions, adds a dependency, a table or
migration, infra or an env var, or changes an agent's model, prompt routing or tools. An owner's
call the issue (or its parent spike's Decisions) does not settle is a **stop**: go to "Asking"
below. One the issue settles, you follow — and any departure goes under "Deviations from the
issue" in the PR.

## Steps

1. **Check the issue is yours to build.** It is open and carries `agent: ready`, or the owner
   named it in this conversation. Otherwise stop and report why. Working tree: your own worktree
   or branch, clean (`git status`).
2. **Read the contract.** `gh issue view <n> --comments`; the parent spike's body (its Settlement
   sections) and comments; BOARD.md "PR lifecycle" and "Agent lane"; the docs AGENTS.md's "Where to
   find more" names for the layers you touch; the skills AGENTS.md says to load. Done when you
   can list which `Dn` decisions and acceptance criteria each part of the work answers to.
3. **Claim it.** `gh issue edit <n> --remove-label "agent: ready" --add-assignee @me` and
   `.github/scripts/board.sh set <n> Status "In Progress"`.
4. **Plan, and test the plan against the settled line.** Write the plan: approach, layers and
   files, tests, and what it touches — code only, infra, env or secrets, migrations or storage
   schema, prompts. Walk it
   against the settled line. Any unsettled owner's call → "Asking". Otherwise comment the plan on
   the issue (`gh issue comment <n> --body-file …`) so the owner can read what is coming.
5. **Branch.** `gh issue develop <n> --base dev --name <type>/<n>-<slug>`, fetch, switch to it.
   Run the repo's install command from AGENTS.md when its dependencies are not installed.
6. **Implement** per AGENTS.md (its architecture rules, comment style and the design docs it
   names) and test per the repo's testing guidance, named in AGENTS.md. Commits are conventional
   with a scope; the code commit and the test commit are separate, formatting-only changes in a
   third (AGENTS.md, "Git & PRs"). Anything AGENTS.md, BOARD.md or the PR template says must
   change together with the code (a doc, a catalog entry) changes in the same PR.
7. **Check locally, briefly.** The repo's typecheck and test commands from AGENTS.md, the tests
   narrowed to the files you added or touched when its runner allows. The full suite, lint and
   build are CI's job.
8. **Open the PR** into `dev` from `.github/pull_request_template.md`, every section filled:
   - **Product summary** in product terms, no file paths. "What a human must do" lists the issue's
     human-only steps plus any you found, each as `- [ ] (before merge) …` or
     `- [ ] (after release) …` — or "Nothing". A probe that needs the code deployed is after
     release; anything the merge itself depends on is before merge.
   - **Deviations from the issue**: every departure from the issue or spike, with its reason — or
     "None".
   - `Closes #<n>`; every box the template asks you to tick, ticked truthfully; the IMPORTANT
     block when the issue carries `breaking-change`.
   Then `board.sh set <n> Status "In Review"`.
9. **Drive CI green.** `gh pr checks <pr> --watch`, run in the background — a queued CI outlasts a
   foreground command's timeout. On a failure read `gh run view <run> --log-failed`,
   fix, push, watch again. After three failed rounds, or a failure outside your change, go to
   "Asking" with the failure as the question. Done when every check passes.
10. **Report**: the PR link, its product summary in two lines, the deviations, and what a human must
    do.

## Asking

1. Comment on the issue: what is blocked, the question, 2–4 options with their consequence for
   users, your recommendation, and what you already did (branch, commits) so a later run resumes.
2. `gh issue edit <n> --add-label "agent: needs-human"` and `board.sh set <n> Status Blocked`.
3. Push any work in progress to the issue branch, and stop. The owner answers by editing the
   issue's Decisions, removes the label and applies `agent: ready` again.

## Boundaries

The run's whole footprint is its issue branch, its PR and its issue. Merging, pushing to `dev` or
`main`, applying `agent: human-approved`, the release PR, deploys, cloud consoles and secrets, memory files, docs the
issue did not ask for, and the local `.env` all belong to people or to `motta-ship-pr`.
