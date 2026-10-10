# motta-claude-mods

Marketplace for personal mods for Claude Code: the one place a new machine restores them from.

## Mods

| Mod | Source | What it does |
| --- | --- | --- |
| `motta-statusline` | this repo | Two-line status line: folder, repo link, git state, the branch's PR (CI checks, conflicts or behind its base, review), model and effort, context as a bar of the window (green under 30%, yellow to 50%, orange to 70%, red past it, with a white tick where auto-compact fires) beside the tokens used, rate limits, and In and Out tokens, with the main session's generation rate on `Out` (`@84/s`: output tokens per second of the last model request, `@~84/s` estimated while one streams, `waiting 3s` before its first token). A toast says when CI fails or passes, a conflict appears, a review lands or the PR merges. The PR comes from `gh pr view`, so it needs `gh` signed in; no PR, no segment. When a refresh fails (offline, expired sign-in) the last reading stays up, dim. Draws under the prompt by default (visible while Claude works); `placement: above` draws it as a band above the prompt instead. |
| `assumption-check` | this repo | A side pane, beside `/filetree`, of the assumptions Claude makes, one dropdown per prompt. Each card holds the assumption, why Claude made it, its confidence, category, source and what breaks if it is wrong. **Reinforce** adds a note Claude reads (no turn), kept as the pinned list and said again after a compaction, with **save to memory** from there. **Wrong** opens a field: type the right assumption, or leave it empty and Claude asks you; either way Claude first lists what it built on the wrong one. **Why?** asks Claude for its reasoning, **undo** takes a mark back with a note, **reinforce all** confirms a whole prompt, and `/assumption-check export` (or the pane's button) writes the cards to `~/.claude/assumption-check/`. Off until `/assumption-check on`, or the `startOn` option: while off it adds no instruction, tool or note, so Claude works as without it. Unmarked cards change nothing. Main session only: a subagent's or teammate's call to the tool makes no card. |
| `prompt-enhancer` | this repo | A small **✦ enhance** chip above the prompt (or `/enhance <text>`) that rewrites your draft before you send it. First it asks 2–4 questions about what the draft leaves out (none when it is clear), one at a time, Enter with nothing to skip; then it writes three versions, **Tight**, **Balanced** and **Thorough**, following Anthropic's and OpenAI's prompting guidance: task first, XML sections, checkable success criteria, `[placeholders]` for facts it lacks. Paths, @mentions, /commands and code come back verbatim, and the card names any a version changed. **Use it** puts the version in the box, **Send** sends it, **Copy** copies it; the card shows the tokens spent. The `model` option: `session` (default) forks this conversation, so it knows what "that" refers to, on the session's model and from the prompt cache (once the cache has lapsed, a long conversation is billed again in full); or `haiku`, `sonnet`, `opus` or a full id, sent the last messages as an excerpt, with an `effort`. Where an app does not let mods read the prompt box, the chip turns into a hint for `/enhance` and the card drops **Use it**. |
| `replay-theater` | this repo, vendored from [anthropics/claude-code-playground@569c528](https://github.com/anthropics/claude-code-playground/tree/569c528/claude-code/mods/replay-theater) (Apache-2.0) | Step through the file edits Claude made in the last turn with `/replay`. Patched to show nothing in the band on its own. |
| `filetree` | [data-goblin/claude-code-filetree@bf8de32](https://github.com/data-goblin/claude-code-filetree/tree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5) (MIT) | IDE-style file tree with git status; shimmers on files Claude reads and writes. Open with `/filetree` (fullscreen layout, terminal 110+ columns). |
| `savvy-progress` | [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT) | Agents panel (`/agents-info`): each subagent's model, context, cost and time. |

Third-party mods are pinned to the commit that was reviewed. To take an upstream update, review its diff, then move the `sha` in `.claude-plugin/marketplace.json`.

## New machine

[setup/SETUP.md](setup/SETUP.md) makes a Windows machine's Claude match the others: log in, clone this repository, install the mods, merge the settings in [setup/](setup/), add the skills. Every step is a command with a check, so a Claude session pointed at that file can run it. It also lists what comes with your Claude account and what no machine can carry.

## Where mods draw

- **CLI:** everything.
- **Desktop app (Code tab):** the band above the prompt, panes and slash commands. It does not raise the hint line under the prompt, so `motta-statusline` draws in the band there on its own, without the model and effort the app's picker already shows. Installed from this checkout as a folder marketplace, it reads the mods from the folder, as the CLI does: an edit reaches a session at its next start or on `/reload-plugins`, with no version bump or `claude plugin update`.
- **claude.ai web and cloud sessions:** none; they do not load local plugins.

The band above the prompt is shared: `prompt-enhancer` draws its chip and cards under whatever the mods beneath it drew (`motta-statusline` with `placement: above`, or on the desktop), and `replay-theater` takes it while it has edits to show. Panes (`/filetree`, `/assumption-check`, `/agents-info`) share one place too, as tabs: docked beside the transcript in the fullscreen layout from 110 columns, inline above the prompt otherwise.

## Developing

Add this checkout as a directory marketplace and edits go live in the CLI on `/reload-plugins`:

```
claude plugin marketplace add <path to this checkout>
```

Checks, per mod in this repo:

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

Vendored mods go in as an unmodified upstream commit first, each patch as its own commit after it.
