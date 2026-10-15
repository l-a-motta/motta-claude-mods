## Product summary

<!-- Base branch: feature PRs target `dev` (the integration branch), NOT `main`.
     `main` only receives the periodic `dev` -> `main` release PR (tech-lead reviewed).

     This section is for a reviewer who will not read the code. Write it in product terms —
     {{AUDIENCE}}, channels ({{CHANNELS}}), what {{PRODUCT}} does — with no file
     paths. The approval (`agent: human-approved` label or an approving review) is given on this
     section; see "Agent lane" in .github/BOARD.md.

     "Closes #123" links the PR to its issue. It does NOT close the issue on a `dev` merge:
     the issue is closed by hand after the merge and set to Done (BOARD.md, PR lifecycle).

     ⚠️ RELEASE PRs (dev -> main) that carry any `breaking-change`-labelled issue MUST
     open with an "⚠️ IMPORTANT / POSSIBLY BREAKING" block: the issue, what it removes or
     changes, how to detect a regression, how to roll back — and need explicit human review
     (see .github/BOARD.md, "Releasing"). Feature PRs for such an issue carry the same block. -->

Closes #

### What changes for users

<!-- Before → after, per channel or kind of user affected. "Nothing user-visible" is a valid
     answer for refactors, tests and infra. -->

- Before:
- After:

### What {{PRODUCT}} can do now, or no longer does

<!-- The capability change in one or two lines, so we can answer "can {{PRODUCT}} do X?".
     "No change" when none. -->

### Risk and blast radius

<!-- Who is affected if this is wrong, how we would notice (an alarm, a log line, a user's
     report) and how bad it gets. -->

### Rollback

<!-- Revert the PR and redeploy? A switch to flip? Data to restore? -->

### What a human must do

<!-- A live probe or login-dependent test, an MFA-gated cloud change, a deploy, a secret value,
     another team's approval. One `- [ ]` item each, starting with when it happens:
     `- [ ] (before merge) …` or `- [ ] (after release) …`. "Nothing" when none. An open
     before-merge item keeps the PR out of the automatic ship step; after-release items move to
     the release PR. -->

### Deviations from the issue

<!-- Every decision this PR made that the issue (or its parent spike's decisions) did not settle,
     or settled differently, with the reason. "None" when it followed the issue exactly. -->

---

## Technical details

### Changes

-

### Full changes description

<!-- Free-form space: tell the full story of what was done and why, in as much
     detail as needed. Design decisions, trade-offs, alternatives considered,
     gotchas for reviewers, follow-ups left out of scope — anything that doesn't
     fit the bullet list above. -->

### How was this tested?

<!-- `{{TYPECHECK_CMD}}` / `{{TEST_CMD}}` output, a manual run (`{{RUN_CMD}}`),
     or "CI only" (see AGENTS.md, Verification). -->

### Checklist

- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass
- [ ] `{{DESIGN_DOC}}` updated in the same PR when the design, a decision or a layer's status changed
- [ ] No secrets or `.env` files committed
- [ ] Linked issue is on the [delivery board](https://github.com/orgs/{{OWNER}}/projects/{{PROJECT_NUMBER}})
