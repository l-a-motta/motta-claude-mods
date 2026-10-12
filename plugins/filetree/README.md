<h1 align="center">Claude Code Filetree</h1>

<p align="center">
  An IDE-style file tree for Claude Code that shows what Claude is doing and where in files
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-%E2%89%A5_2.1.287-D97757?logo=claude&logoColor=fff" alt="Claude Code 2.1.287 or newer">
  <img src="https://img.shields.io/badge/version-0.2.28-blue" alt="Version">
  <img src="https://img.shields.io/badge/type-mod-6f42c1" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-shimmer.gif" alt="filetree shimmering the file Claude is editing" width="900">
</p>

> [!NOTE]
> filetree is a Claude Code **mod** and needs **Claude Code 2.1.287+**. It shows in the right sidebar, which in the terminal needs the fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide; the Desktop app docks it on its own, and `/filetree` reopens it there after you close it. Tested on Linux, macOS and Windows; mods don't load in WSL sessions of the Desktop app.

---

## Installation

This copy is vendored into motta-claude-mods from [data-goblin/claude-code-filetree@bf8de32](https://github.com/data-goblin/claude-code-filetree/tree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5) (MIT), patched to draw only the rows that fit the host's 100,000-character bound (on the desktop, "⋮ N more" rows page the rest) and to list the files Claude reads or changes outside the tree's folder, and installs from that marketplace:

```bash
claude plugin install filetree@motta-claude-mods
```

[setup/SETUP.md](../../setup/SETUP.md) adds the marketplace on a new machine.

## Features

- Interactive file tree for the working directory where you're using Claude Code; it follows the cwd, or `/filetree <path>` pins another folder
- The pane says what is on. The top line is the root as a breadcrumb (click a folder above to move there, pinned) and a badge, `following cwd` or `pinned`, that switches between the two; the pin survives a reload of the mod. Under it the buttons, grouped: `go` (`↑` up a folder, `⌂` back to the cwd, `↻` refresh) and `view` (`hidden on/off`, `sizes on/off`, `⊟` collapse all, `? key on/off`). Then chips for the settings, each a button that cycles it for this session: `scrolls to Claude` or `stays where you scroll`, `shows reads + writes` (or writes only, reads only, no activity), `opens: preview` (or the default app, or your command). `? key` opens a key to every color and mark
- Search the file tree, including folders you have not opened yet
- Git status per file and folder in color, the letters as tags, with exact lines changed (`+N` `-N`) on modified files and `?:N M:N D:N` file counts on folders, in VS Code's colors (its dark theme's git decorations and line counts)
- Branch, upstream and ahead/behind in the header
- Visual indicator of Claude reads and searches (blue) and writes (yellow), in the colors `tool-borders` gives those tool calls: muted inside the tree's folder, brighter outside it. Git operations shimmer in their own hues: commits green, pushes teal, pulls, fetches and checkouts sky blue, merges and PRs purple, resets and removals red like a failed operation; stash and mv shimmer as writes. Collapsed folders open to show the file. While a file shimmers, the action shows beside its name as a tag in the same color, in place of its date: `reading`, `editing`, `writing`, `creating`, or for Bash and git `committing`, `staging`, `moving`, `stashing` and the like. A deleted file leaves the tree, so it has no row to label
- Files outside the tree's folder that Claude reads or changes, like a file in a parent folder, are listed under the search box ("outside this folder"), newest first, shimmering in the same colors and labelled `read` or `changed`. The list holds everything since your last prompt and clears when you send the next one, or when you press its `×`; the terminal shows the newest five and a `⋮ N more` count, and the desktop shows them all. Click one to move the tree to its folder with the file selected (pinned, like `↑`; `⌂` goes back), right-click to copy its path. It covers the Read, Edit, Write and NotebookEdit tools and the files Bash readers (`cat`, `grep`, `rg`, …) name; a file a Bash command changes outside the folder (`sed -i ../x`, a script) is not listed, since writes are found by scanning the tree's own folder

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-read.gif" alt="Files shimmer purple while Claude reads and searches them" width="800">

- Git and GitHub operations via `git` and `gh` (commit, push, pull, checkout, merge, PR and more) shown as a status at the bottom of the pane

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-git.gif" alt="A committed file shimmers green and the footer shows the commit" width="800">

- Selection-aware: the selected file is passed to Claude as context through a `prompt.submit` hook (the bottom line says `sent with your prompts` and its `×` stops it), and `@path` mentions in a prompt reveal that file in the tree

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-ask.gif" alt="Selecting config.yaml in the tree and asking Claude what it changed there" width="800">

- File and folder sizes: the `Σ` header button swaps the date column for sizes; folders show their disk usage (`du`, or a summed listing on Windows), worked out in the background for the rows on screen and refreshed after Claude writes
- Double-click a file to preview it in the pane (or, per **Open with**, its default app or a command)
- Click to select, arrow keys to move through the tree
- Light on large repos: outside a repo it only checks once whether one exists, and every git call is scoped to the cwd
- Nerd Font icons with a plain Unicode fallback
- On Omarchy, the pane takes its colors and background from the current theme and follows theme switches

### Resizing the pane

You can resize the pane with the mouse, or by setting custom `pane:grow` or `pane:shrink` keybindings in `keybindings.json`

<p align="center">
  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-resize.gif" alt="Dragging the filetree pane edge to resize it" width="900">
</p>

## Settings

All settings are in `/config` under filetree.

- **Claude activity:** what shimmers: `reads and writes` (default), `writes`, `reads` or `none`; it sets what goes in the list of files outside the folder too. Git status, line counts and the git status at the bottom always show.
- **Follow Claude:** `on` (default) scrolls the tree to what Claude reads, writes or commits; `off` keeps the view where you put it, and highlights still show.
- **Right column:** `date` (default) or `size`; what the right column shows when a session starts. The `Σ` button in the header toggles it.
- **Open with:** `preview` (default) shows a double-clicked file in the pane: Markdown rendered, code highlighted, arrow keys, Page Up/Down and the wheel to scroll, `←`/`h` or `← files` back to the tree, `↗` the default app. `app` (or empty) opens it in its default app instead. Otherwise a command that double-click and Enter run instead: `{path}` is the file and `{dir}` its folder, and without `{path}` the path goes last. It runs without a shell, so quote a word that holds spaces, and it should start the viewer and return rather than wait for it. Examples: `zed {path}`, `code -g {path}`, or in herdr a tab running [herdr-file-viewer](https://github.com/smarzban/herdr-file-viewer) on the file: `herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement tab --focus --env HERDR_FILE_VIEWER_OPEN={path}`.
- **Glyphs:** `auto` (default) uses Nerd Font icons when a Nerd Font is installed and your terminal started after it was installed, plain Unicode in the desktop app, and Nerd Font over SSH. `nerd` or `plain` forces one.

## herdr

Clicking rows needs herdr 0.9.1 or later. herdr 0.9.0 and older accept pixel mouse reporting but still send cell positions, which would put every click in the session in the wrong place, so on those versions the rows ignore the mouse and the rest of the pane and session keep working. Run `herdr update` to get row clicks.

## Contributing

Turn on the pre-commit hook once per clone; it runs `claude plugin validate` and the plugin tests before each commit that touches the plugin:

```bash
git config core.hooksPath .githooks
```

The same checks run on macOS, Windows and Linux in CI on every push that touches the plugin.

## License

[MIT](LICENSE)

*This project is inspired by my Omarchy app [FileBlade](https://github.com/data-goblin/fileblade)*
