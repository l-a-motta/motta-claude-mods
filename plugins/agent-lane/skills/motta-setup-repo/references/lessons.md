# Lessons from setting up a repo for the agent lane

Each one cost a detour when a repo was set up from another's rules; the templates cannot enforce them, so the
setup run must.

## GitHub reads some files only from `main`

- **Issue forms, `config.yml` and the PR template** load from the default branch only. Nothing shows in the web UI
  until the first `dev` → `main` release merges. Until then, file issues with the `gh` recipe in `BOARD.md`.
- **The `agent-lane` workflow (`pull_request_target`) runs as it is on `main`.** It never ran in a repo that had it
  only on `dev`, and started reacting right after a release put it on `main`. So the first ships after setup are by
  hand (`node .github/scripts/ship-pr.mjs <pr> --dry-run`, then without `--dry-run`), and a fix to the workflow
  takes effect only after the next release.

## The ship job's permissions

- The workflow's `permissions:` block sets every permission it leaves out to `none`. The CI gate lists the head
  commit's check runs, so the job needs `checks: read` beside `contents`, `pull-requests` and `issues: write`.
  Without it the job fails with `Resource not accessible by integration (HTTP 403)` before any gate. The template
  has it; keep it when adapting.
- The ship gate waits for check runs. A repo with no CI never ships: every PR stops at the CI gate after the
  wait. Keep at least one blocking (non-advisory) CI job, and never name a CI job `agent-lane…` (the gate skips
  those).

## The board

- **Copy, don't rebuild.** `copyProjectV2` from a same-owner board brings the fields with their option colours and
  descriptions, the three views and 10 of the 11 automations. Only **Auto-add to project** is not copied, and no
  API creates it: it is a human step (board → Workflows → Auto-add, filtered to the repo).
- Without a source board, create the fields from `board/board.json` (`createProjectV2Field`), and the three views
  are a human step too: no API creates views.
- **Rewriting a single-select field's options** (`updateProjectV2Field` with `singleSelectOptions`) regenerates
  every option ID and blanks that field on every item. It is safe only on a board with zero items, which is why
  the setup rewrites Area right after the copy and before adding anything.
- **A new project's item list lags.** `projectV2.items` (and `gh project item-list`, and the Table view) read 0
  for a while even though the items exist with their fields. Verify through the issue instead:
  `repository.issue(number).projectItems`, or `board.sh get <n>`.
- **Don't create throwaway projects to test something.** `deleteProjectV2` needs org-admin rights; you will only be
  able to close it, and the owner has to delete it.

## Secrets and settings that don't travel

- `BOARD_TOKEN` (a token with read/write on the org's Projects) cannot be read from another repo. Ask the owner
  to add it; without it the ship step still merges but leaves the board as it was.
- `AGENT_LANE_OWNERS` is a repo variable (comma-separated logins); while it is unset, no label ships anything.
- Project-scope plugin settings live in `.claude/settings.local.json` of each checkout and can't be written from a
  worktree session. Prefer user scope for plugins the owner uses everywhere (`mattpocock-skills`, `agent-lane`).

## Porting prose

- `config.yml`'s Discussions contact link was dead in both repos. Keep `blank_issues_enabled: false` only, unless
  Discussions is on.
- History cited in BOARD.md (issue numbers, commits) belongs to the repo it happened in. Qualify it
  (`owner/repo#123`) or drop it; a bare `#123` points at the wrong issue in the new repo.
- The Area list is the new repo's own vocabulary (from its design doc), never the source repo's. It appears in the
  board field, `BOARD.md` and all five forms, and they must agree.
- Line endings: add `.gitattributes` (`* text=auto eol=lf`) before committing scripts, so `board.sh` keeps LF
  on Windows checkouts.
