# motta-claude-mods

Marketplace for personal mods for Claude Code: the one place a new machine restores them from.

## Mods

| Mod | Source | What it does |
| --- | --- | --- |
| `motta-statusline` | this repo | Two-line status line: folder, repo link, git state, the branch's PR (CI checks, conflicts or behind its base, review), model and effort, context, rate limits and tokens. A toast says when CI fails or passes, a conflict appears, a review lands or the PR merges. The PR comes from `gh pr view`, so it needs `gh` signed in; no PR, no segment. When a refresh fails (offline, expired sign-in) the last reading stays up, dim. Draws under the prompt by default (visible while Claude works); `placement: above` draws it as a band above the prompt instead. |
| `replay-theater` | this repo, vendored from [anthropics/claude-code-playground@569c528](https://github.com/anthropics/claude-code-playground/tree/569c528/claude-code/mods/replay-theater) (Apache-2.0) | Step through the file edits Claude made in the last turn. Patched so its band hint lasts one prompt. |
| `filetree` | [data-goblin/claude-code-filetree@bf8de32](https://github.com/data-goblin/claude-code-filetree/tree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5) (MIT) | IDE-style file tree with git status; shimmers on files Claude reads and writes. Open with `/filetree` (fullscreen layout, terminal 110+ columns). |
| `savvy-progress` | [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT) | Agents panel (`/agents-info`): each subagent's model, context, cost and time. |

Third-party mods are pinned to the commit that was reviewed. To take an upstream update, review its diff, then move the `sha` in `.claude-plugin/marketplace.json`.

## New machine

The repository is private, so the machine needs git access to it (`gh auth login`).

```
claude plugin marketplace add l-a-motta/motta-claude-mods
claude plugin install motta-statusline@motta-claude-mods --scope user
claude plugin install replay-theater@motta-claude-mods --scope user
claude plugin install filetree@motta-claude-mods --scope user
claude plugin install savvy-progress@motta-claude-mods --scope user
claude plugin enable cc-plugin-you-should-know@builtin
```

`cc-plugin-you-should-know` ships inside Claude Code, off by default: a side agent that flags things in the reply worth knowing.

Settings are not carried by plugins; set these by hand.

`~/.claude/settings.json`: no `statusLine` key (the mod replaces it), plus

```json
{
  "env": {
    "FORCE_HYPERLINK": "1",
    "CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS": "1"
  },
  "preferredNotifChannel": "terminal_bell"
}
```

- `FORCE_HYPERLINK` makes the status line's repo link clickable where Claude Code does not detect OSC 8 support (VS Code's terminal). Ctrl+click there opens it twice, once from the terminal and once from Claude Code; a plain click opens it once.
- The notification pair rings the terminal bell when a reply finishes, and only then. `auto` sends nothing on Windows terminals.

`~/.claude.json` (global config, edit it with no session running): `"messageIdleNotifThresholdMs": 1000`, so the bell rings one second after a reply rather than sixty. Any key press or click in that second cancels it.

VS Code `settings.json`, when Claude Code runs in its terminal:

```json
{
  "terminal.integrated.enableVisualBell": true,
  "terminal.integrated.bellDuration": 10000,
  "accessibility.signals.terminalBell": { "sound": "on" },
  "terminal.integrated.gpuAcceleration": "off"
}
```

`gpuAcceleration: off` keeps mouse clicks on the cell under the pointer in the fullscreen layout; the GPU renderer drifts at fractional display scaling.

## Where mods draw

- **CLI:** everything.
- **Desktop app (Code tab):** the band above the prompt, panes and slash commands. It does not raise the hint line under the prompt, so `motta-statusline` draws in the band there on its own, without the model and effort the app's picker already shows. It also runs the copy cached at install, not this checkout: after editing a mod, bump its `version` and run `claude plugin update <mod>@motta-claude-mods` before the app sees it.
- **claude.ai web and cloud sessions:** none; they do not load local plugins.

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
