# savvy-progress

A Claude Code mod: live progress bars in the transcript and a live panel of subagents. Made for the [savvy-flow](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/savvy-flow) skill, and useful with any subagents.

- **A row under each call** in the transcript, redrawn as its agents work, with a button showing the crew size that opens the panel:
  - an Agent call: its agent's name, `N tools · ✗ failed · time`, and an activity strip, one tick per tool call in that call's color (see Colors), red where it failed, pulsing while it runs;
  - a Workflow call: the workflow's name, its agents done out of started, and a strip per agent (eight at most, then `+n`);
  - savvy-flow's latest `progress` call: the flow's title, phase and accepted tasks out of planned, as a bar. The bar moves down to each new call; a flow that ends keeps its last state on its row.
- **A roll call in the band** above the prompt, under the status line (keyed `band-under:`, so the status line and the chips keep their places), while agents work together: drawn as the status line draws its lines: `agents` (pressed, it opens the panel) and a crab per agent, dim once done, a red ✗ on one that failed, then `2 running  14 tools  ✗ 1  31s  $0.24`, each figure at full strength and its word dim. With an agent's transcript open it names that agent alone, with its reported steps. A live savvy flow shows its bar instead. It leaves once its agents are done; its ✕ hides it until the next batch.
- **A timeline on top of the panel**, open by default (its toggle folds it): a ruler of the session in clock time, each of your turns a bar, idle stretches over 10 seconds folded into a dashed box with the clock times around them; then one batch per turn of yours (the agents your message set going, its agents' follow-up turns included), newest first. Its header names the turn, its agents, failures and your message; the line under it when it started and ended (`at 14:02` within one minute), how long it ran and the idle time before it. The newest batch is open as lanes, newest on top, numbered `#n` as the cards are; older batches fold to one strip of their runs until pressed. Durations carry units everywhere (`29s`, `2m52s`), so a colon is a clock time. `$.savvyProgress.open()` lets another mod open the panel (turn-receipt's `agents` does).
- **Agents panel** (`/agents-info` toggles it). Each agent's card has its model, effort, reported steps or context, tokens, estimated cost and time, and:
  - its tool calls by family (`■ read 5 ■ change 2 ■ run 1`) and a red `✗ n` badge for the failed ones;
  - while it runs, its last three actions, newest first: tool calls with ✓ or ✗ once they end, and the phrase it is writing, or thinking (`✻`) while it has written nothing yet. Written once a second;
  - a bubble over its crab acting out what it does now: the running call's sign in that call's color (a page to read, a globe for the web, a pencil to change, `>_` to run, a crab to delegate), a speech bubble while it writes, a thought bubble while it thinks;
  - after 45 s with no streamed output and no call starting or ending, an amber `◷ waiting on Bash · 1:20` when a call is still running, else `◷ quiet 0:52`; after 5 minutes it is **overdue**: an amber clock for its mark, `overdue` in its line and its crab asleep, eyes shut under an amber z (amber on its call's row too), until it does something. That also covers an agent whose stop savvy cannot see: the engine's list never names a workflow's agents;
  - the files it touched, as pills, newest first (on the stats line's empty left side, unless the agent reports steps that need it), each bordered in the color of the riskiest thing done to it (tool-borders' order: bookkeeping < read < change < delegate < run, whenever it happened), bright as far as it is. A shell command's files count, judged piece by piece: in `node build.js && cat notes.md`, `build.js` ran and `notes.md` was read;
  - once finished, the first line of its answer.

  Failed agents are pinned on top. A stopped one (Esc, the tasks list or TaskStop: not a failure) shows a gray `■` and is listed with the finished; savvy asks the engine's agent list each second while any run, so a stop that ends no turn it sees still lands. The rest are grouped by the call that started them, running groups first; a group of two or more has a header (`Workflow · 3 · 1:12`). Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them. Failed and Finished each fold under their header; `Compact view`, on its own row above them, folds the whole pane to one strip: the crabs grouped by status, failed first, each group led by its mark and count, each crab's name over it (its title's first word, past a `Demo:`-style prefix) and a mini bar under it. The full view opens with the same strip, above the tiles, without the stats they already show.

## Who wears what

Every subagent's crab gets a costume that tells its role, read from facts the engine already has. Nothing is asked of the agent:

1. A savvy tier by its name (`savvy-careful` is the engineer).
2. Otherwise a role its name spells out, word by word: scout or explore is the pirate, audit, review or critic the detective, architect, plan or design the astronaut, develop, implement or build the engineer, compare or judge the chef, QA, test or verify the racer. So `hd-auditor` is a detective. The table is `ROLE_WORDS` in `hooks/register.tsx`.
3. Otherwise the tier its model and effort run at: Opus at xhigh is heavy, at high careful, at medium medium, at low light; Sonnet is medium, Haiku light, Fable fable. Effort arrives with the agent's first request, so its costume can change once then.
4. Otherwise the plain crab.

## Colors

- **An agent** is its model's color, whatever its role: Opus indigo, Sonnet teal, Haiku lime, Fable pink, anything else gray (`MODEL_COLOR` in `hooks/register.tsx`). Its model's name, running dot and crab's body take it, the costume's accent keeping the brand clay; its role (`Explore`, `general-purpose`) is bold, and its crab's costume tells it. A planned savvy task takes the color of the model its tier runs on.
- **The card's bar** is gray, filled by the steps the agent reported (darker) or, without them, by its context; a finished agent keeps the fill it had. A stopped agent's crab fades and its bar ends in a cap where it stopped, the rest hatched; the compact strip draws the same.
- **A tool call** is colored as [tool-borders](../tool-borders) colors its row in the transcript: the hue says what it does (gray bookkeeping, blue read, yellow change, clay delegate, magenta run), the brightness how far it reaches (muted in the project folder, medium elsewhere on this machine, bright on the internet), read from the call's name and input. The ticks, the bubble's sign and the trail use the call's own color; the tool mix and the changed-file chips the family's medium tone.
- **Outcomes**: one green for done and a call that worked (`#3B9C5F`), one red for failed (`#E24B4A`), gray for work in progress (a flow's bar, a row of several agents) and for stopped (`■`), amber for the idle note.

### Connected to tool-borders

`hooks/tool-kinds.ts` is a copy of tool-borders' classifier (everything in its `hooks/register.tsx` above `register`), since a mod can import only its own files. **The two are connected: change them together.** Both mods carry the same `tests/tool-kinds.cases.ts`, the calls and colors they must agree on, so a change to one copy fails that mod's tests until the other copy and both case files follow.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks.
- `mcp__savvy-progress__step`: a subagent reports its own steps (`done`, `total`, `note`). With `stepReports` on (the default), the tool sits in every request's tool list, and its description asks every subagent, and no main conversation, to report: only on tasks of more than a few tool calls, and always in the same response as a real tool call, so it adds almost no requests. A subagent that does not report shows its context fill in grey instead. Agents with a fixed `tools:` list in their definition do not get the tool unless the list names it.

"Processed" adds up every token each model request sent and got back, cache reads included, so it grows with every request a subagent makes; the context figure on each row is that agent's latest request alone. Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`), not a bill.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English.

`stepReports`: `true` (default) or `false`. Off when accuracy matters more than the bar: planning steps and reporting them can distract an agent or anchor it to a plan that turned out wrong. Off, subagents are not asked, and the tool waits behind tool search as upstream has it, for savvy-flow workers told to call it.

Set them in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

Changed here from upstream: the bars moved from the band above the prompt into the transcript, a bar for any subagent or workflow, the "Processed" label, a costume for any subagent, and step reports asked of every subagent (`stepReports`). Vendored into motta-claude-mods from [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT). Install it with `claude plugin install savvy-progress@motta-claude-mods`; [setup/SETUP.md](../../setup/SETUP.md) adds the marketplace on a new machine.
