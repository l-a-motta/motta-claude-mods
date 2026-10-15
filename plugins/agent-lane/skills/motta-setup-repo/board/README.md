# {{BOARD_TITLE}}

Single source of truth for what the team is delivering on [{{REPO}}](https://github.com/{{OWNER}}/{{REPO}}).
The rules every person and agent follows live in the repo, in [`.github/BOARD.md`](https://github.com/{{OWNER}}/{{REPO}}/blob/dev/.github/BOARD.md).

## How we work

- **Every piece of work is an Issue** in the repo, added to this board.
- **Status** drives the board: `Backlog -> Todo -> In Progress -> In Review -> Approved -> Done -> Released`, with `Closed` and `Blocked` off the flow.
- **Priority**: `P0` (drop everything) / `P1` (this iteration) / `P2` (deferrable) / `P3` (not prioritized) / `Deferred`.
- **Size**: XS / S / M / L / XL — rough t-shirt estimate, set during triage.
- **Area**: which part of the system the work touches (see `{{DESIGN_DOC}}`).
- **Target**: date we expect it shipped, for delivery-facing items.

## Rituals

- **Triage**: new issues land in `Backlog` with `needs-triage`. Triage sets Priority, Size, Area.
- **Done is not Released**: Done is merged into `dev`; Released is in `main` through the `dev` -> `main` release PR.

## Views

- **Board View** — kanban by Status (default working view)
- **Table View** — every field, for triage
- **Roadmap** — timeline by Target date
