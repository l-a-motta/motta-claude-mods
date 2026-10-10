# savvy-progress

A Claude Code mod: live progress bars in the transcript and a live panel of subagents. Made for the [savvy-flow](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/savvy-flow) skill, and useful with any subagents.

- **Progress bars**, drawn under the transcript row of the call that started the work, each redrawn as it runs, with a button showing the crew size that opens the panel:
  - an Agent call: "Subagents", its agent done or not;
  - a Workflow call: the workflow's name, its run's agents done out of started;
  - savvy-flow's latest `progress` call: the flow's title, phase and accepted tasks out of planned. The bar moves down to each new call; a flow that ends keeps its last state on its row.

  Nothing is drawn above the prompt, so the band there stays free for the status line.
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

Changed here from upstream: the bars moved from the band above the prompt into the transcript, a bar for any subagent or workflow, the "Processed" label. Vendored into motta-claude-mods from [JohnnyVizz/claude-kit@272a877](https://github.com/JohnnyVizz/claude-kit/tree/272a877f39b6971690e087b16a7cc3951b811e39/plugins/savvy-progress) (MIT). Install it with `claude plugin install savvy-progress@motta-claude-mods`; [setup/SETUP.md](../../setup/SETUP.md) adds the marketplace on a new machine.
