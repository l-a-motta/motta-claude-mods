# Setting up a new machine

Everything here makes a Windows machine's Claude match the others: the same mods, settings and skills, with nothing tied to a project or employer outside the work skills of step 6. Each step is a command and a check; run the check before moving on. To have Claude do it, open a session in this checkout and point it at this file.

Commands are PowerShell unless they say otherwise.

## What comes from where

| Comes with | What | You do |
| --- | --- | --- |
| Logging into your Claude account | claude.ai connectors (Gmail, Calendar, Drive, Slack and the rest), the plugins synced from claude.ai (pdf-viewer, desktop-commander, enterprise-search, cowork-plugin-management), synced skills, and the Code tab's account settings (branch prefix, auto-archive when a PR closes) | Log in (step 1) |
| This repo | The mods, the agent-lane skills, `settings.json`, the preferences in `~/.claude.json`, the find-skills skill | Steps 2 to 6 |
| Nowhere | Logins to other tools (`gh`, Codex), session history, file history, memories, the Code tab's per-machine settings (notifications, keep-awake, worktree location, browser tools) | Log in to tools as you need them; Code tab settings in step 7 |

Claude Code's `settings.json` does not sync with your account. The `remote-settings.json` file it keeps is for settings an organization pushes.

## 1. Install Claude and log in

Install the desktop app from <https://claude.com/download> and sign in. Then install Claude Code (the CLI) and log in with the same account. After the installer finishes, open a new PowerShell window before running `claude`, so it is on the PATH:

```powershell
irm https://claude.ai/install.ps1 | iex
claude
```

In the session, run `/login` if it asks, then `/exit`.

Check: `claude --version` prints a version, and `claude plugin list` shows plugins marked `@synced`.

## 2. Tools and the repository

Install Git for Windows (it brings Git Bash), Node.js 18 or newer, and the GitHub CLI. Then sign in to GitHub and clone this private repository to the same place as on the other machines:

```powershell
gh auth login
New-Item -ItemType Directory -Force "$HOME\Documents\Coding" | Out-Null
gh repo clone l-a-motta/motta-claude-mods "$HOME\Documents\Coding\motta-claude-mods"
Set-Location "$HOME\Documents\Coding\motta-claude-mods"
```

Check: `node --version` is v18 or later, and `git -C "$HOME\Documents\Coding\motta-claude-mods" status` says `On branch main`.

## 3. The mods

Add this checkout as a folder marketplace and install the mods from it. A session runs each mod from the copy the install made, so an edit reaches it after a version bump, `claude plugin update <mod>@motta-claude-mods` and a new session. Then install each mod and switch on the one that ships inside Claude Code:

```powershell
claude plugin marketplace add "$HOME\Documents\Coding\motta-claude-mods"
claude plugin install motta-statusline@motta-claude-mods --scope user
claude plugin install context-drill@motta-claude-mods --scope user
claude plugin install changes-drill@motta-claude-mods --scope user
claude plugin install usage-drill@motta-claude-mods --scope user
claude plugin install prompt-enhancer@motta-claude-mods --scope user
claude plugin install emotive-spinner@motta-claude-mods --scope user
claude plugin install tool-borders@motta-claude-mods --scope user
claude plugin install filetree@motta-claude-mods --scope user
claude plugin install savvy-progress@motta-claude-mods --scope user
claude plugin install turn-receipt@motta-claude-mods --scope user
claude plugin enable cc-plugin-you-should-know@builtin
```

`cc-plugin-you-should-know` is off by default: a side agent that flags things in a reply worth knowing.

Check: `claude plugin list` shows the ten mods and `cc-plugin-you-should-know` as enabled, and `motta-statusline` reads `Read from:` this checkout.

## 4. Settings

Close every Claude session first, the desktop app included: Claude Code rewrites `~/.claude.json` while it runs. Then merge both files. Each merge keeps every key it does not name, backs the file up as `<file>.bak-setup`, and lists what it set:

```powershell
node setup/merge.mjs setup/settings.json "$HOME\.claude\settings.json"
node setup/merge.mjs setup/claude.json "$HOME\.claude.json"
```

If the first one says `remove by hand: statusLine`, delete that key from `settings.json`: `motta-statusline` replaces the status line, and an old `~/.claude/statusline.sh` can go too.

Check: both of these end with `ok:`.

```powershell
node setup/merge.mjs setup/settings.json "$HOME\.claude\settings.json" --check
node setup/merge.mjs setup/claude.json "$HOME\.claude.json" --check
```

What the settings do, where it is not obvious from the name:

- `model`, `effortLevel`, `modelSettings`, `advisorModel`: Opus with the 1M context window at high effort, Fable as the advisor.
- `permissions.defaultMode: auto` with `autoMode.soft_deny`: auto mode by default, and its defaults plus a pause before any AWS command aimed at a production profile.
- `tui: fullscreen`, `theme: dark`, `voice` (hold to talk).
- `FORCE_HYPERLINK` makes the status line's repo link clickable where Claude Code does not detect OSC 8 support (VS Code's terminal). Ctrl+click there opens it twice, once from the terminal and once from Claude Code; a plain click opens it once.
- `preferredNotifChannel: terminal_bell` with `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` rings the terminal bell when a reply finishes, and only then. `auto` sends nothing on Windows terminals. `messageIdleNotifThresholdMs: 1000` in `~/.claude.json` rings it one second after a reply rather than sixty; a key press or click in that second cancels it.
- `promptSuggestionEnabled: false` turns off the greyed-out guess at your next prompt. Claude Code makes that guess with a second request over the whole conversation after each turn; with the setting off the request is never sent. A mod can only hide the guess once it is made, so this is a setting rather than a mod.
- `CLAUDE_CODE_USE_POWERSHELL_TOOL`: the PowerShell tool beside Bash. It is already on by default for a claude.ai account once Git for Windows is installed; the variable keeps it on whatever the account type. Windows only.
- `pluginConfigs`: the built-in AGENTS.md plugin loads a project's `AGENTS.md` files where it has no `CLAUDE.md` of its own (the default, written out so it stays put).
- `cleanupPeriodDays: 210` keeps session transcripts for 210 days.

## 5. The find-skills skill

From [vercel-labs/skills](https://github.com/vercel-labs/skills), pinned to the commit that was reviewed (`0b8fb22`):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills\find-skills" | Out-Null
Invoke-WebRequest "https://raw.githubusercontent.com/vercel-labs/skills/0b8fb22aaa7f82447d4befe1b6a95d30a5b279b8/skills/find-skills/SKILL.md" -OutFile "$HOME\.claude\skills\find-skills\SKILL.md"
```

Check: `Select-String -Path "$HOME\.claude\skills\find-skills\SKILL.md" -Pattern '^name: find-skills'` prints one line.

## 6. The work skills: agent-lane

One plugin in this repo carries skills for work rather than drawing. `agent-lane` holds the seven `motta-*` skills of the agent lane. They work in whichever repo they run in, following that checkout's `.github/BOARD.md` and scripts (today `vtex-copilot/vtex-copilot-fse` and `vtex-copilot/copilot-sentinel`), and stop in a checkout without a `BOARD.md`. Those repos keep no copies of the skills, so this plugin is where they change. `motta-setup-repo` is stage zero: run `/agent-lane:motta-setup-repo` in a new repo and it sets up the board, `BOARD.md`, issue forms, PR template, CI, ship workflow and scripts and `AGENTS.md` from its templates, then lists what only you can do (the `BOARD_TOKEN` secret, the board's Auto-add workflow).

```powershell
claude plugin install agent-lane@motta-claude-mods --scope user
claude plugin install mattpocock-skills@claude-plugins-official --scope user
```

`mattpocock-skills` brings general skills such as `grilling` and `code-review`.

On a machine that still has the retired `motta-heavydev` plugin, remove it: `claude plugin uninstall motta-heavydev@motta-claude-mods --scope user`, then delete `~/.claude/motta-heavydev.json` if it exists.

Check: `claude plugin list` shows `agent-lane` and `mattpocock-skills` enabled, and no `motta-heavydev`.

## 7. The desktop app's Code tab

In the desktop app, Settings → Claude Code:

- **Prompt suggestions**: off. The app has its own switch beside `promptSuggestionEnabled`; the setting already wins, and the switch off keeps the two in agreement.

Every other Code tab setting is left at its default, and the account ones (branch prefix, auto-archive) arrive with the login.

## 8. VS Code (only when Claude Code runs in its terminal)

In VS Code's `settings.json`:

```json
{
  "terminal.integrated.enableVisualBell": true,
  "terminal.integrated.bellDuration": 10000,
  "accessibility.signals.terminalBell": { "sound": "on" },
  "terminal.integrated.gpuAcceleration": "off"
}
```

`gpuAcceleration: off` keeps mouse clicks on the cell under the pointer in the fullscreen layout; the GPU renderer drifts at fractional display scaling.

## 9. The last check

Start `claude` in any git repository. The status line shows two lines under the prompt, the first with the folder and branch, the second with the context bar. `/filetree` opens the file tree, `/agents-info` the agents panel, `/enhance <text>` the prompt enhancer, and `/context-drill`, `/changes-drill` and `/usage-drill` (or the status line's `ctx`, `files`, `5h` and `7d`) their panes.

## Keeping this in step

When a setting changes on one machine and should follow everywhere, update `setup/settings.json` or `setup/claude.json` here, commit, and on each other machine pull and run step 4 again. `--check` against a machine's own files says whether it has drifted.
