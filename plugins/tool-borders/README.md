# tool-borders

A Claude Code mod: every tool call's row in the transcript gets a colored border that says what the call does and how far it reaches.

- **The hue is its family**: gray bookkeeping (TodoWrite, Skill, ToolSearch…), blue read (Read, Grep, Glob, WebFetch…), yellow change (Edit, Write…, create, update or delete), Anthropic clay delegate (Agent, Workflow, SendMessage…), magenta run.
- **The brightness is its reach**: muted inside the project folder, medium elsewhere on this machine, bright on the internet.

It is read from the tool's name and input, never from what the call touched:

- A shell command (Bash, PowerShell) is judged word by word: `git status` and `ls` read, `git commit`, `mv` and `rm` change, `npm install` and `curl` reach the internet. Of several (`a && b`) the riskiest decides.
- A built-in tool by its name (`BUILTIN` in `hooks/register.tsx`), its reach by the paths and URLs in its input.
- An MCP tool or one the list does not know by the words of its name (`get`, `list`, `search` read; `update`, `write` change; `delegate`, `dispatch` delegate), on this machine when its server is a local one, else the internet.

The colors are `COLORS` in `hooks/register.tsx`.

## How the call got through

The stroke says how the call got past the permission check:

- **A rule or the mode allowed it:** one bar on the desktop, a round border in the CLI.
- **The auto-mode classifier decided:** two thin bars, a double border.
- **You were asked** (the dialog showed): a bold border, and `you allowed it` under the row.
- **Refused:** red, with `✗ denied by rule`, `✗ denied by classifier` or `✗ you denied it` under the row.

It reads `tool.check` (allow, ask or deny), the classic `PermissionRequest` hook, which fires just before the dialog shows, and `PermissionDenied`, which fires when the classifier refuses; the call's `tool.call` settles an ask. A call drawn before the mod loaded keeps the plain mark.

## Connected to savvy-progress

[savvy-progress](../savvy-progress) colors its tool calls (its activity strips, tool mix, trail and the bubble over each agent's crab) with a copy of this classifier, `savvy-progress/hooks/tool-kinds.ts`, since a mod can import only its own files. **The two are connected: change them together.** Both mods carry the same `tests/tool-kinds.cases.ts`, the calls and colors they must agree on, so a change to one copy fails that mod's tests until the other copy and both case files follow.
