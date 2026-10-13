# branch-drill

A Claude Code mod: a Branches pane on top of [changes-drill](../changes-drill), for where your work stands among the branches.

- **Me**: your branch beside main, with how far behind and ahead it is and whether it is pushed (each count opens its commits), or **Where's my work**: the files on this computer, your branch here, your branch on GitHub and main, as boxes joined by commit, push and pull request.
- **All**: every branch as lanes, a commit a row (text art in the terminal), or a **Subway** map of main's last merges as stops and each branch as a loop, with the stops listed under it.

Each section has its own picker. Hovering a commit or a term shows a card, a branch's rows light up together, and clicking a commit opens its files.

It reads local git only: when the pane opens, on its Refresh, and at a turn's end while it is up (the whole log only when a ref moved). Nothing is fetched, nothing is written, no model is called and nothing is added to the context. The `historyDepth` option sets how many commits it reads (40).

## Connected to changes-drill

It is the Me and All sections that used to sit in changes-drill's History section, which keeps Current (what is happening now). **The two go together**: changes-drill's History section has a **Branches ▸** button that opens this pane through `$.branchDrill.open()`, and without branch-drill a toast says to install it. branch-drill lists changes-drill under `dependencies`, and reads its record of which turn and who changed each file (`$.state`, `changes-drill.touches`) for the turn pills and the cards.

Since a mod imports only its own files, `hooks/history.ts` and the git reading in `hooks/git.ts` and `hooks/register.tsx` are copies of changes-drill's: a fix to one is a fix to make in the other.

Open it with `/branch-drill`, the Changes pane's Branches button, or `$.branchDrill.open()` from another mod.

## On the desktop

The desktop app stops drawing a pane past about 2,000 elements, so the pane draws at the richest level that fits a budget of 1,000: first the drill-down cards go (a commit's, a file's), then every card, then the lanes and the commit lists stop at 15 commits with a line saying how many are hidden, then the subway's stops fold under one line. The terminal always draws everything.
