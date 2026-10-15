---
name: motta-settle-spike
description: Settle a spike with the owner — put its open decisions to them as numbered options, record their picks in the spike, and file the feature issues an agent can build unattended. Use when the owner asks to settle, finish, plan or close out a spike.
---

# Settle a spike: decisions → agent-ready issues

The second stage of the agent lane (`.github/BOARD.md`, "Agent lane"), with the owner present. The
issues this produces are built by runs nobody watches, so every product or architecture call they
need is made **here**, by the owner, and written down. A call left implicit becomes a stalled run
(`agent: needs-human`) or a PR built on a guess.

**The repo is the current checkout.** Its `.github/BOARD.md` is the rulebook for everything below,
and the scripts, issue forms and PR template named here are that checkout's own, under `.github/`.
If the checkout has no `.github/BOARD.md`, stop and say this repo isn't set up for the agent lane.

## Steps

1. **Load the spike.** `gh issue view <n> --comments`, the issues it links, its parent epic if
   any, and the code and docs it touches — enough to know which options are real and what each
   costs. Read BOARD.md "Agent lane" and `.github/ISSUE_TEMPLATE/feature.yml`. Done when you can
   state the spike's answer, or what is still missing for one, in two sentences.
2. **Draft the decisions.** Number every open call `D1, D2, …` — product calls first (what the
   users the product serves, or its internal users, see or can do; channels; tone), then architecture (layers, new
   dependencies, tables, infra, auth, model or routing changes). For each: 2–4 options, the
   consequence of each for users, and your recommendation. Add the proposed feature issues (each
   `XS`–`M`; split anything bigger), the human-only steps you foresee, and whether it is a breaking
   change. Lead with a two-sentence summary; keep it enumerated.
3. **Get the owner's picks.** Present the draft and record the answers. Re-ask anything answered
   ambiguously. Done when every `Dn` has a picked option or the owner's own wording, and no question
   remains open — the owner's terse "1 A, 2 B, 3 default" style is a complete answer.
4. **Write the settlement into the spike body.** Edit the body (write it to a temp file, then
   `gh issue edit <n> --body-file`): keep Question, Context, Timebox, Expected outcome and Area; fill
   each `### Settlement: …` section — decisions as `Dn — decision — why`, rejected options and out of
   scope, the feature issues as a checklist, human-only steps, breaking change.
5. **File the feature issues** with the CLI recipe in BOARD.md. Title prefix by kind (`feat:`,
   `fix:`, `chore:`), with its label and Type. Every body uses the `feature.yml` headings — fixes and
   chores included, because these headings are the contract the build run reads:
   `### Parent spike` (`#<n>`), `### Problem / opportunity`, `### Product impact`,
   `### Proposed solution`, `### Decisions that bind this work` (the `Dn` lines it depends on,
   verbatim, with the spike's numbering), `### Out of scope`, `### Acceptance criteria`,
   `### Human-only steps`, `### Breaking change?`, `### Area`, `### Additional context`.
   Then: attach each as a **sub-issue** of the spike (BOARD.md, "Sub-issues"); add
   `breaking-change` when it is one; set Status `Todo`, Priority, Size and Area with
   `.github/scripts/board.sh`. Tick each issue into the spike's feature checklist as `#<n>`.
6. **Mark them ready.** Check each issue against BOARD.md "The agent-ready bar" and show the owner
   one table: issue, Size, ready or not (with the failing item). Apply `agent: ready` only to the
   issues the owner approves (`gh issue edit <n> --add-label "agent: ready"`).
7. **Close the spike.** `gh issue close <n> --reason completed --comment "Settled. Feature issues: #a, #b."`
   and `board.sh set <n> Status Closed`. A spike whose answer needs no code closes the same way,
   with the answer in the comment.
8. **Report**: the decisions in one line each, the filed issues with links and their ready state,
   and the next step — `/motta-dispatch` for the ready ones.
