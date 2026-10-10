# motta-claude-mods

Marketplace for personal mods for Claude Code: the one place a new machine restores them from. Every mod's code is in this repository, the third-party ones included, so any of them can be changed here.

## Mods

| Mod | Source | What it does |
| --- | --- | --- |
| `motta-statusline` | this repo | Two-line status line: folder, repo link, git state, the branch's PR (CI checks, conflicts or behind its base, review), model and effort, context as a bar of ten dashes across the window (green under 30%, yellow to 50%, orange to 70%, red past it, with a white tick where auto-compact fires and the room past it still drawn) beside the tokens used, rate limits, and In and Out tokens, with the main session's generation rate on `Out` (`@84/s`: output tokens per second of the last model request, `@~84/s` estimated while one streams, `waiting 3s` before its first token). A toast says when CI fails or passes, a conflict appears, a review lands or the PR merges. The PR comes from `gh pr view`, so it needs `gh` signed in; no PR, no segment. When a refresh fails (offline, expired sign-in) the last reading stays up, dim. Draws under the prompt by default (visible while Claude works); `placement: above` draws it as a band above the prompt instead. On the desktop app it leaves out the model and effort (its model picker shows them) and the PR (its PR bar shows it; the toasts stay), and a narrow band wraps between segments instead of inside them. |
| `assumption-check` | this repo | A side pane, beside `/filetree`, of the assumptions Claude makes, one dropdown per prompt. Four counts sit on top: to check, low confidence, corrected and confirmed; press one to show only its cards, again to show all. Each card holds the assumption, why Claude made it, its confidence, category, source and what breaks if it is wrong; the source opens in VS Code at its line. Within a prompt, low-confidence cards come first and the first of a batch opens on arrival; one arriving while the pane is not shown raises a toast. Four buttons per card. **Right** marks it confirmed, and a prompt's **all right** confirms all its open cards; undo puts one back. **Wrong** opens a field: type the right assumption, or leave it empty and Claude asks you; either way Claude first lists what it built on the wrong one. **Why?** asks Claude for its reasoning. **Delete** removes the card from the mod's memory, and a prompt with no cards left leaves the pane. Only wrong and why? reach Claude, each as a prompt; right and delete stay in the pane. On from the session start; `/assumption-check off`, or the `startOn` option set to false, turns it off: while off it adds no instruction, tool or note, so Claude works as without it. Main session only: a subagent's or teammate's call to the tool makes no card. |
| `prompt-enhancer` | this repo | A small **✦ enhance** chip above the prompt, shown during turns too (or `/enhance <text>`), that rewrites your draft before you send it. Press it and an **Enhance** pane opens with your draft; pick one; only that one is written, in one model call. **Cleaned up**: a cheap model (`cleanModel`, `haiku` by default), with no conversation, fixes typos, fillers ("uh", "ah"), other voice-to-text artifacts and punctuation, and leaves every other word, the wording, the language and the structure as you wrote them. **Expanded**: the shortest prompt that keeps everything that matters, task first, with how to check the work and `[placeholders]` for facts it lacks, written with the conversation. Paths, @mentions, /commands and code come back verbatim, and the card names any the result changed. The pane shows the result under your draft (before and after) with the tokens spent. **Use it** puts the result in the box, **Send** sends it, **Copy** copies it; Use it, Send, cancel and discard close the pane, and closing it yourself cancels the job. Expanded's `model` option: `session` (default) forks this conversation, so it knows what "that" refers to, on the session's model and from the prompt cache (once the cache has lapsed, a long conversation is billed again in full); or `haiku`, `sonnet`, `opus` or a full id, sent the last messages as an excerpt, with an `effort`. Where an app does not let mods read the prompt box, the chip turns into a hint for `/enhance` and the pane drops **Use it**. |
| `replay-theater` | this repo, vendored from [anthropics/claude-code-playground@569c528](https://github.com/anthropics/claude-code-playground/tree/569c528/claude-code/mods/replay-theater) (Apache-2.0) | Step through the file edits Claude made in the last turn with `/replay`. Patched to show nothing in the band on its own. |
| `filetree` | this repo, vendored from [data-goblin/claude-code-filetree@bf8de32](https://github.com/data-goblin/claude-code-filetree/tree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5) (MIT) | IDE-style file tree with git status; shimmers on files Claude reads and writes. Open with `/filetree` (fullscreen layout, terminal 110+ columns). |
| `savvy-progress` | this repo, vendored from [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT) | Agents panel (`/agents-info`): each subagent's model, context, cost and time. |

Third-party mods are vendored: an unmodified copy of the reviewed commit, with its license, lands in `plugins/<mod>/` in a commit of its own, and our changes come after it in commits of their own. To take an upstream update, review its diff from the commit named above, apply it over our changes, and move that commit in the table and in the mod's marketplace description.

## New machine

[setup/SETUP.md](setup/SETUP.md) makes a Windows machine's Claude match the others: log in, clone this repository, install the mods, merge the settings in [setup/](setup/), add the skills. Every step is a command with a check, so a Claude session pointed at that file can run it. It also lists what comes with your Claude account and what no machine can carry.

## Where mods draw

- **CLI:** everything.
- **Desktop app (Code tab):** the band above the prompt, panes and slash commands. It does not raise the hint line under the prompt, so `motta-statusline` draws in the band there on its own, without the model and effort the app's picker already shows. A session there runs each mod from the copy `claude plugin install` or `claude plugin update` made under `~/.claude/plugins/cache/`, even where `claude plugin list` names this checkout under `Read from`, and `/reload-plugins` does not swap a mod the session loaded at its start. An edit reaches it after a version bump, `claude plugin update <mod>@motta-claude-mods` and a new session.
- **claude.ai web and cloud sessions:** none; they do not load local plugins.

The band above the prompt is shared, and the mods' hooks on it run in an order none of them picks, so each tree says how it shares through its root Box's key: `band-beside:<mod>` draws at the right of the status line, `band-under:<mod>` under it, and an unkeyed tree takes the band. `prompt-enhancer` keys its chip beside and draws nothing else in the band, so `motta-statusline` (with `placement: above`, or on the desktop) keeps its lines with the chip on the right edge in either order; `replay-theater` takes the band while it has edits to show. Panes (`/filetree`, `/assumption-check`, `/agents-info`, the enhancer's) share one place too, as tabs: docked beside the transcript in the fullscreen layout from 110 columns, inline above the prompt otherwise.

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
