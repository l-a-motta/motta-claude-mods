---
name: motta-dispatch
description: List the agent-ready issues and start one worktree build session per issue (desktop app).
disable-model-invocation: true
---

# Dispatch build runs

Starts the third stage of the agent lane (`.github/BOARD.md`, "Agent lane") from the Claude
desktop app: one side session per issue, each in its own worktree, each running
`motta-build-issue`. Runs are independent, so they go in parallel.

## Steps

1. **List the candidates.**
   `gh issue list --repo vtex-copilot/vtex-copilot-fse --label "agent: ready" --state open --json number,title,labels,assignees`.
   Drop any issue with an open PR already (`gh pr list --base dev --state open --search "<n> in:body"`)
   or labelled `agent: needs-human`, saying why.
2. **Confirm.** Show one numbered table: issue, title, Size, Area (`.github/scripts/board.sh get <n>`).
   Ask the owner which to start — all by default — and wait for the answer.
3. **Start the sessions.** One `start_session` per chosen issue, `initiation: "user_asked"`,
   `context: "fresh"`, `use_worktree: true`, `title: "Build #<n>: <issue title>"`,
   `name: "build-<n>"`, and:
   - `prompt`: `Run the motta-build-issue skill on issue #<n> of vtex-copilot/vtex-copilot-fse. You run unattended: the issue and its parent spike are your only source of decisions; when they do not settle a call, follow the skill's "Asking" section and stop.`
   - `background`: `The owner settled this issue's decisions in advance and dispatched it to be built without supervision, alongside other build sessions in their own worktrees. The run ends with a PR into dev and CI green, or a question on the issue. The owner reviews the PR's product summary and ships it with motta-ship-pr.`
4. **Report** the started sessions as links. When they end, summarise each in one line — PR link
   or the question asked — and point the owner at the PRs to read and label `agent: human-approved`.
