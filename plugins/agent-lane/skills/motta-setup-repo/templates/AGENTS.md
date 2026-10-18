# AGENTS.md

<!-- setup: one line on who the agent is for this stack, e.g. "You are a TypeScript developer experienced with <the main framework>." -->

<!-- setup: if the stack has a docs skill the agent must load before any work (installed in step 5), add a short "CRITICAL: load `<skill>`" section here naming it and why; otherwise add nothing. -->

## What this project is

<!-- setup: two or three sentences — what {{PRODUCT}} is, who it serves, and that `{{DESIGN_DOC}}` is the source of truth for the design. Point at the living doc; never copy its current state here. -->

### Architecture rules

<!-- setup: the rules every change must respect (layering, determinism, where policy lives), taken from `{{DESIGN_DOC}}`, plus the framework's traps that bite every change (what its build drops, what it logs or exports). -->

## Commands

<!-- setup: package manager, how its version is pinned, and the commands. -->

```bash
{{INSTALL_CMD}}
{{RUN_CMD}}
{{TYPECHECK_CMD}}
{{TEST_CMD}}
```

CI (`.github/workflows/ci.yml`) runs these checks, the agent-lane script tests (`node --test .github/scripts/*.test.mjs`) and a secret scan on every PR into `dev` or `main`.

### Testing

<!-- setup: where tests live, the runner, and what every change must test. "Test behaviour, never wording." -->

## Project Structure

<!-- setup: one table row per top-level folder or key file, with what it holds. -->

| Path | Description |
| ---- | ----------- |

## Where to find more

| Need                                         | Read                                       |
| -------------------------------------------- | ------------------------------------------ |
| Design, decisions, next steps                | `{{DESIGN_DOC}}`                           |
| Issues, board, branches, PRs, the agent lane | `.github/BOARD.md` (lazy-load — see below) |

## Git & PRs

> **Lazy-load this section's docs.** The GitHub/board rules (`.github/BOARD.md`, issue forms, PR template) are read **only when you are about to interact with Git or GitHub** (issues, board, branches, commits, PRs) — never preload them at session start; they must not occupy context during ordinary coding work.
>
> **But the moment you touch an issue or the board, load `.github/BOARD.md` first and follow it exactly.** That means _every_ interaction — reading an issue for its context, creating or triaging one, changing its Status or assignees, branching for it, opening or merging its PR. It is the single standard everyone (humans and agents) follows. Do not work an issue from memory of the rules.

Work happens on the [delivery board](https://github.com/orgs/{{OWNER}}/projects/{{PROJECT_NUMBER}}) — issues carry the full context for each task. The rules that apply even before you open `BOARD.md`:

- **Branching model — work collects on `dev`, releases to `main`.** Branch off **`dev`** with a typed prefix (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`) and open your PR **into `dev`**. `main` only receives a periodic, tech-lead-reviewed **`dev` → `main` release PR**. **Never PR a feature branch straight into `main`**; never commit directly to `main` or `dev`; never force-push shared branches.
- **Release PRs merge with "Create a merge commit" — never "Squash and merge", and `dev` is never deleted.** A squashed release breaks the ancestry between `dev` and `main`; deleting `dev` silently retargets every open PR to `main`. Recovery steps are in `.github/BOARD.md`.
- **Commits** are conventional with a scope (`feat(<area>): …`, `chore(ci): …`). Test changes and formatting-only changes always land in their **own commits**, never mixed with functional source changes: first the code commit, then the test commit, then any formatting sweep (`style: …`). A reviewer must be able to read the functional diff without wading through assertion sweeps or formatting churn.
- **Follow the `.github/` templates** (issue forms, PR template). Every PR links its issue with `Closes #<n>`.
- **Verification.** CI is the verification gate. Run `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` locally only when the change is significant or possibly breaking; otherwise push and let CI verify. Either way, say which in the PR's "How was this tested?" section.

## Boundaries

### Always do

<!-- setup: add the stack's own musts (load a skill, schemas at boundaries, registration points). -->

- Update `{{DESIGN_DOC}}` in the same PR when the design, a decision or a layer's status changes
- Write each code comment as a **why** (a constraint, invariant or trap that holds today, in the present tense) or a **guard** (one or two lines that stop a deliberate change from being undone). Change history goes on the issue or PR, where `git blame` leads. Cite issues as `Issue #123`
- Keep tokens, credentials and personal data out of logs, traces, commits and issues
- Check with the user before reading a large file only to understand its context, to avoid unnecessary token burn
- Use complete references to code (file path and line) so the user can CTRL+Click them

### Never do

- Never commit `.env` files or secrets; never read the local `.env` (`.env.example` is the documented template)
- Never modify `node_modules` or database files directly
- Never hardcode API keys (always use environment variables)
- Never make a change that cannot be rolled back or that can have catastrophic impact on runtime and production; always WARN the user

## Maintaining this file

This file sets direction and context; it is not a history or a status report. State principles and point to the living source (`{{DESIGN_DOC}}`, the board) instead of copying its current state — no counts, issue numbers, dates or statuses here. Decisions made for current circumstances are edited where they live, with their rationale on the issue or PR. Knowledge a future session needs must live in the repo, not in anyone's private notes: when you learn a durable trap, add it to the doc that owns that area.

## Resources

- [Delivery board](https://github.com/orgs/{{OWNER}}/projects/{{PROJECT_NUMBER}}) — what's in flight and what to do next. Read it with `gh project item-list {{PROJECT_NUMBER}} --owner {{OWNER}}`.
- `README.md` — how to run it.
