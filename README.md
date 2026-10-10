# motta-claude-mods

Marketplace for personal mods for Claude Code.

## Mods

| Mod | What it does |
| --- | --- |
| `motta-statusline` | Two-line status line: folder, repo link, git state, model and effort, context, rate limits and tokens. Draws under the prompt by default (visible while Claude works); `placement: above` draws it as a band above the prompt instead. |
| `replay-theater` | Step through the file edits Claude made in the last turn. Vendored from [anthropics/claude-code-playground@569c528](https://github.com/anthropics/claude-code-playground/tree/569c528/claude-code/mods/replay-theater) (Apache-2.0); patched so its band hint lasts one prompt. |

## Install

The repository is private, so the machine needs git access to it (`gh auth login`).

```
claude plugin marketplace add l-a-motta/motta-claude-mods
claude plugin install motta-statusline@motta-claude-mods --scope user
claude plugin install replay-theater@motta-claude-mods --scope user
```

Then `/reload-plugins` in a running session, or start a new one.

`motta-statusline` replaces a `statusLine` command; remove that setting so the two don't both draw. Its repo link is clickable when the terminal gets OSC 8 links; Claude Code does not detect them in every terminal (VS Code's, for one), and `FORCE_HYPERLINK=1` in the `env` of `~/.claude/settings.json` turns them on.

## Developing

Add this checkout as a directory marketplace and edits go live on `/reload-plugins`:

```
claude plugin marketplace add <path to this checkout>
```

Checks, per mod:

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
