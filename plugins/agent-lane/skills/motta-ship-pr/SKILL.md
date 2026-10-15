---
name: motta-ship-pr
description: "Ship PRs the owner approved — for a PR into dev labelled `agent: human-approved`, run the ship script that checks the gates, squash-merges, closes its issues and updates the board and release PR. Use when asked to ship, merge or finish approved PRs, or why an approved PR did not ship."
---

# Ship approved PRs

The last stage of the agent lane (`.github/BOARD.md`, "Agent lane"). The `agent-lane` workflow
runs this on its own when an owner applies `agent: human-approved`. Use the skill to ship by hand — the
workflow is not on the base branch yet, or an earlier run stopped at a gate and the cause is fixed —
and to explain a stop.

`.github/scripts/ship-pr.mjs` is the single implementation: the gates, the merge, the issues, the
board and the release PR. Read its header for the gates and its `stop(...)` calls for each gate's
fix. Never merge around it.

**The repo is the current checkout.** Its `.github/BOARD.md` is the rulebook for everything below,
and the scripts, issue forms and PR template named here are that checkout's own, under `.github/`.
If the checkout has no `.github/BOARD.md`, stop and say this repo isn't set up for the agent lane.

## Steps

1. **Pick the PRs.** The numbers the owner named, or every open PR into `dev` carrying
   `agent: human-approved` (`gh pr list --base dev --label "agent: human-approved" --json number,title`).
2. **Dry-run each one:** `node .github/scripts/ship-pr.mjs <pr> --dry-run`. It prints the gate that
   stops it, or "all gates pass".
3. **Ship the ones that pass:** `node .github/scripts/ship-pr.mjs <pr>`, as a command of its own so
   the permission check sees exactly what it approves. For a stopped PR, report the gate and its
   fix. Don't clear the gate yourself: ticking human steps or applying the label is the owner's
   call.
4. **Report** one table: PR, outcome (merged, or the gate that stopped it), issues closed, and
   whether the release PR was updated — the script's closing comment on each PR says so.
