# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or any subagent starts, workflow agents included; with no savvy flow running it reads "Subagents" and counts the agents started since it came up. It shares the band above the prompt: a status line or chip from another mod stays drawn over or beside it.
- **Agents panel** (`/agents-info` toggles it): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead.

"Processed" adds up every token each model request sent and got back, cache reads included, so it grows with every request a subagent makes; the context figure on each row is that agent's latest request alone. Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`), not a bill.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

Changed here from upstream: the bar for any subagent, band sharing, the "Processed" label. Vendored into motta-claude-mods from [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT). Install it with `claude plugin install savvy-progress@motta-claude-mods`; [setup/SETUP.md](../../setup/SETUP.md) adds the marketplace on a new machine.
