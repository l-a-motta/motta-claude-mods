---
name: motta-setup-repo
description: Set up a repo for the agent lane — the dev → main flow, labels, a delivery board, BOARD.md, issue forms, PR template, CI, the ship workflow and scripts, AGENTS.md — then ship the setup through the lane itself. Use when the owner asks to set up, bootstrap or prep a repo with their board, flow, rules or "flightdeck".
disable-model-invocation: true
---

# Set up a repo for the agent lane

Stage zero of the agent lane: after this, `/agent-lane:motta-intake` through `/agent-lane:motta-ship-pr`
work in the repo. The owner is present. **The repo is the current checkout**; its `owner/name` is
`gh repo view --json nameWithOwner --jq .nameWithOwner`.

Everything this skill installs comes from this folder:

- `templates/` — the repo files, with `{{PLACEHOLDERS}}` (listed in step 2). `gitattributes` and `mcp.json`
  install as `.gitattributes` and `.mcp.json`.
- `board/board.json` — the board's fields, views and automations, for when no board can be copied;
  `board/labels.json` — the 14 labels; `board/README.md` — the board's readme.
- `references/lessons.md` — the traps of a setup. **Read it before step 3.**

Templates are the source for new repos only. Repos already set up don't sync from them; port a change by hand.

## Steps

1. **Survey.** `git remote -v`, the default branch, `gh repo view --json visibility,hasIssuesEnabled,hasDiscussionsEnabled`,
   `gh label list`, `gh variable list`, `gh secret list`, `gh project list --owner <owner>`, and what the repo
   already has: `AGENTS.md`/`CLAUDE.md`, `.github/`, a design doc, the package manager and its scripts, a test
   runner, CI, and a `.nvmrc` (the CI template reads the Node version from it; create one from `engines` when
   missing). The owner must be an **organization**: `board.sh` and `BOARD.md` query `organization(login:)`, so for
   a user-owned repo change those queries to `user(login:)` while filling. If `.github/BOARD.md` already exists, stop: the repo is set up; offer to compare it with the
   templates instead. Done when you can say what exists and what is missing in one table.
2. **Interview** — before any remote write, one question at a time, each with your recommendation drawn from the
   survey:
   - **Area list**: 8–12 areas from the repo's design doc or its top-level layers, each with a one-line
     description; usually ending `Storage/Observability`, `Infra`, `Docs`. It fills two placeholders, in these
     exact formats: `{{AREA_OPTIONS}}` (the five forms) becomes one line per area, `        - <Area>` (8 spaces,
     so the YAML stays valid); `{{AREA_LIST}}` (`BOARD.md`) becomes one inline run,
     `` `<Area>` (<description>) · `<Area>` (<description>) ``.
   - **Product terms**: `{{PRODUCT}}` (its name), `{{AUDIENCE}}` (who it serves, as the PR summary says it),
     `{{CHANNELS}}` (where users meet it), `{{DESIGN_DOC}}` (path of the design source of truth).
   - **Commands**: `{{INSTALL_CMD}}` (the frozen install, e.g. `npm ci`), `{{RUN_CMD}}`, `{{TYPECHECK_CMD}}`,
     `{{TEST_CMD}}`, `{{NODE_PM}}` (`npm`/`pnpm`/`yarn`, for CI's cache). Not Node? Rewrite `ci.yml`'s setup steps
     for the stack and keep the agent-lane script tests (they need only `node`).
   - **Board source**: a same-owner board to copy (default: the owner's newest delivery board), or none. Board title
     (`{{BOARD_TITLE}}`, e.g. "<Product> — Delivery Board").
   - **Owners** for `AGENT_LANE_OWNERS` (default: the owner's login).
   Done when every placeholder has a value the owner confirmed.
3. **Remote, in this order** (the flow depends on it):
   1. `dev` from the default branch: `git push origin origin/main:refs/heads/dev`.
   2. Labels from `board/labels.json` (`gh label create <name> --color <c> --description <d> --force`). Keep GitHub's
      defaults.
   3. `gh variable set AGENT_LANE_OWNERS --body <logins>`.
   4. The board. With a source: `copyProjectV2(projectId, ownerId, title, includeDraftIssues: false)`. Without:
      `gh project create`, then each field in `board/board.json` with `createProjectV2Field` (colours and
      descriptions included), and Status's options with `updateProjectV2Field`. Then, **while the board has zero
      items**, set Area's options to the interview's list with `updateProjectV2Field` (never again after items
      exist — `lessons.md`). Link it (`gh project link <n> --owner <owner> --repo <repo>`), set `readme` from
      `board/README.md` and `shortDescription` with `updateProjectV2`. Record the project number, its ID and the
      five field IDs (Status, Priority, Size, Area, Target).
4. **Fill the templates** into a branch off `dev` (it gets its issue in step 6, so name it after that). Replace
   every `{{PLACEHOLDER}}`; then `grep -rn '{{' .github AGENTS.md CLAUDE.md` returns nothing. Write `AGENTS.md`
   from the template's `<!-- setup: … -->` notes with what the survey found; keep its "Git & PRs", "Boundaries"
   and "Maintaining this file" sections. If the repo already has an `AGENTS.md`, merge the template's sections
   into it instead. Add `.claude/worktrees/` to `.gitignore`. Run `node --test .github/scripts/*.test.mjs` and the
   repo's typecheck and tests: CI must pass on the setup PR.
5. **Skills and plugins.** For a Mastra repo, install the `mastra` skill with the skills CLI (`npx skills add
   mastra-ai/skills`, picking `mastra`; it writes `skills-lock.json` — see the `find-skills` skill for the CLI) and
   keep `mcp.json`; otherwise drop the Mastra section of `AGENTS.md` and `mcp.json`. Add any domain MCP servers the
   repo needs to `.mcp.json`. The lane's own skills are this plugin: never copy them into the repo.
6. **Ship the setup through the lane.** File `chore: set up the delivery board, templates and agent lane` with the
   CLI recipe in the new `BOARD.md` (label `type: chore`, Type `Task`, assignee, on the board), and set its fields
   with the new `board.sh` — the first real test of it. Create the branch with `gh issue develop <n> --base dev`,
   commit in groups (board docs and forms; CI, workflow and scripts; the script tests; skills; `AGENTS.md`), open
   the PR into `dev` from the new template with `Closes #<n>`, set `In Review`. When the owner approves, ship it by
   hand — `node .github/scripts/ship-pr.mjs <pr> --dry-run`, then without `--dry-run` (the workflow is not on `main`
   yet).
7. **Release.** With the owner's go, open the `dev` → `main` release PR (a "What ships" table and an "After
   release" checklist, no `Closes #`). It merges only on the owner's explicit go, with **"Create a merge commit"**,
   never "Squash and merge". Then check
   `git ls-remote --heads origin dev` still lists `dev`, `git log -1 --format=%P origin/main` prints two parents,
   the issue forms show at `https://github.com/<repo>/issues/new/choose`, and move the setup issue to `Released`.
8. **Report** what exists now, and **what a human must do**, one line each:
   - add the `BOARD_TOKEN` secret (a token with read/write on the org's Projects);
   - turn on **Auto-add to project** in the board's Workflows, filtered to the repo;
   - create the three views (Board by Status sorted by Priority, Table, Roadmap by Target) when the board was not
     copied;
   - delete any throwaway project you could only close;
   - install `mattpocock-skills` at user scope if it isn't (`claude plugin install mattpocock-skills@claude-plugins-official --scope user`).

## Boundaries

Every remote write in step 3 is reversible except the board's existence (only an org admin deletes a project), so
don't create one to experiment. Never read or copy a secret's value. Merge nothing without the owner's go, and
never squash a release.
