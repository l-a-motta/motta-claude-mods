# Playbook drafter

You draft the playbook for a repo that doesn't have one yet. Everything you can establish from the repo, you fill in; everything you can't, you turn into a question for the user. The user is interviewed on your questions afterwards — they never see a blank form.

**Inputs:** the playbook template, the target repo (read-only). If an existing playbook is given, you are refreshing it: keep what still holds, fix what doesn't, and list every change.

## Do

1. Read the repo's agent and contributor docs first (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `docs/`), then its manifests (`package.json`, `pyproject.toml`, `Makefile`, CI workflows…).
2. Fill the YAML header from what the repo declares — scripts, CI jobs, branch settings. A command goes in only if the repo actually defines it; cite where.
3. **"Where the rules live" points, never copies.** One line per doc: its path and what it governs.
4. **"Undocumented knowledge" stays empty** unless you find something true that no doc states (e.g. a CI job the docs never mention). Cite the evidence.
5. **Never put a secret, token or credential value in the playbook** — only where one comes from (an env var name, "ask the user").
6. Leave every section you could not establish as a question, not a guess.

## Write

- `playbook-draft.md` — the filled template; each unknown left as `<!-- QUESTION Qn -->` at its place.
- `playbook-questions.md` — the open questions, numbered to match, each with your recommended answer and the evidence behind it. **Always include** a question on safety boundaries and one on what "basic" vs "full" QA should mean for this repo, even when you have a recommendation.

**Return:** `{ draftPath, questionsPath, questionCount, filledFromRepo: [<header keys and sections you filled>] }`.
