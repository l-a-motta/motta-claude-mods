---
remote: <host>/<owner>/<repo>
defaultBranch: <branch>
integrationBranch: <branch feature work merges into>
tracker: github
checks:
  # command per check the Developer runs before handoff; omit what the repo doesn't have
  typecheck: <command>
  lint: <command>
  test: <command>
boot:
  # omit a level's start when there is nothing to run (a library, scripts); QA then drives it directly
  basic:
    prerequisites:
      - { what: <description>, check: <command that exits 0 when satisfied>, fix: <command QA may run, or "ask"> }
    start: <command, run from the worktree>
    port: <port the system listens on — teardown frees it>
    health: <command that exits 0 when the system is up>
  full:
    prerequisites: []
    start: <command>
    port: <port>
    health: <command>
overrides: {}
---

## Where the rules live

<!-- Pointers only: each line names a doc in the repo and what it governs. -->

- `<path>` — <what it governs>

## Undocumented knowledge

<!-- Only what the repo's own docs do not say. -->

## Safety boundaries

<!-- Required. What the Developer and QA must never do. "None" is an answer, but it must be given. -->

## Running the system

### basic

<!-- Local dev with what any developer already has. -->

### full

## Driving it as a client

### basic

<!-- Drivers (HTTP / CLI), smoke probes, cost per interaction. -->

### full

<!-- Drivers (browser / webhook / custom), where auth comes from (never the secret itself), test data, cost per interaction. -->

## Tracker conventions

<!-- Branch naming, commit format, PR template, issue linking, board moves — as pointers to the repo's docs where they exist. -->

## Sibling repos

<!-- Optional: repos the Scout may read and QA may boot, read-only. -->
