// assumption-check: a side pane of the assumptions Claude makes.
//
//   ● capture on  [ turn off ]
//   ╭ To check ╮ ╭ Low confidence ╮ ╭ Corrected ╮ ╭ Confirmed ╮
//   │ 2        │ │ 1              │ │ 1         │ │ 1         │
//   ▾ P4 add retry to fetch  2 to check              all right
//     ╭ ▸ A7 ● low  retries = 3, exponential backoff ╮
//     ╭ ▸ ✎ A9 ● high  use axios                     ╮
//   ▸ P3 fix the CI badge · all checked
//
// Each count box filters the cards to its own; pressed again, it shows all.
// Within a prompt, open cards of low confidence come first, and the first
// such card in a batch opens on arrival. One arriving while the pane is not
// shown raises a toast.
//
// On from the session start, unless the startOn option is false.
// `/assumption-check off` switches it off for the session, and while off the
// mod adds nothing Claude reads: no instruction, no tool, no note. On, it
// registers the note_assumption tool, whose description is the instruction:
// when to log the assumptions that shape Claude's work, and how. It rides
// the tool and not a prompt.compose section because this engine's build
// sends no plugin's section to the model. Each call lands as a card under
// the prompt it was logged in. Only the main session's: a subagent's or a
// teammate's call is answered without a card. Their assumptions are theirs
// to show in their own session.
//
// Nothing in the pane reaches the session unless the person asks for it:
// - wrong: a prompt of its own, typed with the right assumption in the card's
//   field or empty, in which case Claude asks what is right. Either way
//   Claude first lists what it did that relied on the assumption.
// - why?: a prompt asking Claude for its reasoning.
// - right (and a prompt's "all right"): marks it confirmed. Claude never
//   hears of it; undo puts it back to check.
// - delete: removes the card from the mod's memory, and Claude never hears
//   of it. Ids keep counting, so a later card never takes a deleted one's.
// - its source: opens path:line in VS Code (`code -g`, else a vscode:// link).
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Category, Confidence, Filter, Group, Status } from '../types'

const PANE = 'assumption-check'
const TITLE = 'Assumptions'
const TOOL = 'note_assumption'
const TAG = '[assumption-check]'

const isOn = atom({ plugin: 'assumption-check', key: 'isOn' } as const, null as boolean | null)
const groups = atom({ plugin: 'assumption-check', key: 'groups' } as const, [] as Group[])
const cards = atom({ plugin: 'assumption-check', key: 'cards' } as const, [] as Card[])
const expanded = atom({ plugin: 'assumption-check', key: 'expanded' } as const, [] as string[])
const selected = atom({ plugin: 'assumption-check', key: 'selected' } as const, null as string | null)
const fixing = atom({ plugin: 'assumption-check', key: 'fixing' } as const, null as string | null)
const filter = atom({ plugin: 'assumption-check', key: 'filter' } as const, null as Filter | null)
const cardCount = atom({ plugin: 'assumption-check', key: 'cardCount' } as const, 0)
const hasAutoOpened = atom({ plugin: 'assumption-check', key: 'hasAutoOpened' } as const, false)

const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high']
const CATEGORIES: readonly Category[] = ['scope', 'intent', 'tech', 'environment', 'data', 'style', 'other']

export const TOOL_DESCRIPTION = `Log the assumptions you act on, for the user to review in their assumption-check pane. When something you act on was neither stated by the user nor verified by you (what they meant, the scope, a technology or library, the environment, the data, a style), log it here. Log only assumptions that shape what you do, not trivia, and each once; batch several in one call.

- Send the call in the same response as your other tool calls. In a reply with no other tool use, make this one call before you answer.
- Logging must not change your plan: do not stop to ask about what you logged, and do not repeat it in your reply.
- Main session only: a subagent or teammate never calls it.
- Prompts marked ${TAG} are the user's own feedback from that pane. A corrected assumption replaces what you assumed.

Returns their ids (A1, A2, ...).`

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    assumptions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'The assumption, one short sentence.' },
          why: { type: 'string', description: 'What led you to it.' },
          confidence: { type: 'string', enum: CONFIDENCES },
          category: { type: 'string', enum: CATEGORIES },
          source: { type: 'string', description: 'Where it comes from, as path:line, when a file does.' },
          impact: { type: 'string', description: 'What goes wrong if it is false.' },
        },
        required: ['statement', 'why', 'confidence', 'category', 'impact'],
      },
    },
  },
  required: ['assumptions'],
}

type Logged = Omit<Card, 'id' | 'group' | 'status'>

// The tool's input, kept to what a card holds; anything else is dropped.
export function parseAssumptions(input: unknown): Logged[] {
  const list = (input as { assumptions?: unknown } | null)?.assumptions
  if (!Array.isArray(list)) return []
  return list.flatMap(raw => {
    const one = raw as Record<string, unknown>
    const statement = text(one.statement)
    if (statement === '') return []
    const confidence = CONFIDENCES.includes(one.confidence as Confidence) ? (one.confidence as Confidence) : 'medium'
    const category = CATEGORIES.includes(one.category as Category) ? (one.category as Category) : 'other'
    const source = text(one.source)
    return [{ statement, why: text(one.why), confidence, category, impact: text(one.impact), ...(source ? { source } : {}) }]
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function quote(card: Card): string {
  return `${card.id} "${card.statement}"`
}

// The prompts the pane submits, each starting a turn.
export const say = {
  wrong: (card: Card) =>
    `${TAG} I marked assumption ${quote(card)} as wrong. Ask me what is incorrect about it and what the right assumption is. Before you change anything, list what you did so far that relied on it.`,
  corrected: (card: Card, correction: string) =>
    `${TAG} I marked assumption ${quote(card)} as wrong. The right assumption: ${correction}\nList what you did so far that relied on it, then fix that work to fit the right one.`,
  why: (card: Card) =>
    `${TAG} Why did you assume ${quote(card)}? Say what led you to it and what else you considered. Don't change anything yet.`,
}

export function groupLabel(prompt: string): string {
  const line = prompt.replace(/^\[assumption-check\]\s*/, '').split('\n')[0]?.trim() ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || '(empty prompt)'
}

const MARK: Record<Status, string> = { open: '○', wrong: '✗', corrected: '✎', confirmed: '✓' }
const CONFIDENCE_COLOR: Record<Confidence, string> = { low: 'error', medium: 'warning', high: 'success' }
const BORDER: Record<Status, string> = { open: 'subtle', wrong: 'error', corrected: 'error', confirmed: 'success' }

export const MATCHES: Record<Filter, (card: Card) => boolean> = {
  open: c => c.status === 'open',
  low: c => c.status === 'open' && c.confidence === 'low',
  marked: c => c.status === 'wrong' || c.status === 'corrected',
  confirmed: c => c.status === 'confirmed',
}

// Open cards of low confidence first; the rest keep the order they came in.
export function ordered(list: readonly Card[]): Card[] {
  return [...list].sort((a, b) => Number(!MATCHES.low(a)) - Number(!MATCHES.low(b)))
}

// "path:line", "path:line:col" or "path:start-end"; a drive's colon stays.
export function parseSource(source: string): { path: string; line?: number } {
  const match = /^(.+?):(\d+)(?:[-:]\d+)?$/.exec(source.trim())
  return match?.[1] !== undefined ? { path: match[1], line: Number(match[2]) } : { path: source.trim() }
}

function absolute(path: string, cwd: string): string {
  const joined = /^([A-Za-z]:)?[\\/]/.test(path) ? path : `${cwd}/${path}`
  return joined.replace(/\\/g, '/')
}

async function setCard($: EngineInterface, id: string, change: (card: Card) => Card) {
  await update($, cards, list => list.map(c => (c.id === id ? change(c) : c)))
}

async function confirm($: EngineInterface, ids: readonly string[]) {
  await update($, cards, list => list.map(c => (ids.includes(c.id) && c.status === 'open' ? { ...c, status: 'confirmed' as const } : c)))
  await update($, fixing, id => (id !== null && ids.includes(id) ? null : id))
}

// The path is made absolute so it never reads as an option of `code`, and
// only VS Code is asked to open it: a source is Claude's text, and a file
// handed to the system's default app could be a program that runs.
async function openSource($: EngineInterface, source: string) {
  const { path, line } = parseSource(source)
  const file = absolute(path, await $.session.cwd())
  const at = line === undefined ? file : `${file}:${line}`
  const url = `vscode://file/${encodeURI(at.replace(/^\/+/, ''))}`
  // Linux has xdg-open and macOS open; Windows hands a URL to rundll32.
  const openers = /^[A-Za-z]:/.test(file)
    ? [['code', '-g', at], ['rundll32', 'url.dll,FileProtocolHandler', url]]
    : [['code', '-g', at], ['xdg-open', url], ['open', url]]
  for (const argv of openers) {
    try {
      if ((await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0) return
    } catch {}
  }
  $.ui.toast(`Couldn't open ${source} in VS Code.`)
}

async function toastIfHidden($: EngineInterface, low: readonly Card[]) {
  if (low.length === 0) return
  const panes = await $.ui.panes()
  if (panes.some(p => p.id === PANE && p.isShown && p.isPlaced)) return
  const first = low[0]!
  $.ui.toast(
    low.length === 1
      ? `Low-confidence assumption ${quote(first)}. Run /assumption-check to review it.`
      : `${low.length} low-confidence assumptions: ${low.map(c => c.id).join(', ')}. Run /assumption-check to review them.`,
    { timeoutMs: 8000 },
  )
}

// Whether capture is on. Until it is first switched, the startOn option
// answers; once switched, the switch holds when the module loads again.
async function capturing($: EngineInterface, startOn: boolean) {
  return (await read($, isOn)) ?? startOn
}

async function turnOn($: EngineInterface) {
  await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
  await update($, isOn, () => true)
  $.ui.invalidate('tool.describe')
}

async function turnOff($: EngineInterface) {
  await update($, isOn, () => false)
  $.ui.invalidate('tool.describe')
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

async function markWrong($: EngineInterface, card: Card, typed: string) {
  const correction = typed.trim()
  await setCard($, card.id, c => ({ ...c, status: correction ? 'corrected' : 'wrong', ...(correction ? { correction } : {}) }))
  await update($, fixing, () => null)
  void $.prompt.submit({ text: correction ? say.corrected(card, correction) : say.wrong(card) })
}

async function remove($: EngineInterface, card: Card) {
  await update($, cards, list => list.filter(c => c.id !== card.id))
  await update($, selected, id => (id === card.id ? null : id))
  await update($, fixing, id => (id === card.id ? null : id))
}

export const register: Register = (on, options) => {
  const startOn = options.startOn !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'assumption-check',
      description: 'Open the assumptions pane; `on` or `off` switches capture',
      argumentHint: '[on|off]',
    })
    if (await capturing($, startOn)) await turnOn($)

    return next(e)
  })

  on('command.run', { command: 'assumption-check' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on') {
      await turnOn($)
      return { text: 'Assumption capture is on for this session. The pane opens with the first card.' }
    }
    if (arg === 'off') {
      await turnOff($)
      return { text: 'Assumption capture is off. Your cards stay in the pane.' }
    }
    await openPane($)
    return { text: (await capturing($, startOn)) ? 'Assumptions pane opened.' : 'Assumptions pane opened. Capture is off: `/assumption-check on` starts it.' }
  })

  // A tool cannot be unregistered: once capture is off its description
  // tells Claude to leave it alone.
  on('tool.describe', { tool: 'mcp__assumption-check__note_assumption' }, async ($, e, next) =>
    (await capturing($, startOn)) ? next(e) : { description: 'Inactive: assumption-check is off. Do not call this tool.' },
  )

  // A new dropdown per prompt, while capture is on.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'task-notification' && (await capturing($, startOn))) {
      const list = await update($, groups, all => [...all, { id: `P${all.length + 1}`, label: groupLabel(e.text) }])
      await update($, expanded, () => [list.at(-1)?.id ?? 'P1'])
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__assumption-check__note_assumption' }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'Not logged: assumption-check shows the main session only. Do not call this tool again.' }
    if (!(await capturing($, startOn))) return { result: 'assumption-check is off; nothing was logged. Stop logging assumptions.' }
    const logged = parseAssumptions(e)
    if (logged.length === 0) return { deny: 'No assumption to log: pass `assumptions`, each with at least a `statement`.' }

    let group = (await read($, groups)).at(-1)?.id
    if (group === undefined) {
      group = 'P1'
      await update($, groups, () => [{ id: group, label: '(before capture was on)' }])
      await update($, expanded, () => [group])
    }
    const last = await update($, cardCount, n => n + logged.length)
    const added: Card[] = logged.map((one, i) => ({ ...one, id: `A${last - logged.length + 1 + i}`, group, status: 'open' as const }))
    await update($, cards, list => [...list, ...added])

    const low = added.filter(MATCHES.low)
    // Not while a correction is being typed: that would fold its field.
    if (low[0] !== undefined && (await read($, fixing)) === null) await update($, selected, () => low[0]!.id)
    if (!(await read($, hasAutoOpened))) {
      await update($, hasAutoOpened, () => true)
      void openPane($)
    } else {
      // A toast is a nicety: failing, it must not lose the cards' ids.
      await toastIfHidden($, low).catch(() => {})
    }
    return { result: `Logged ${added.map(c => c.id).join(', ')}. Carry on; the user reviews them in their pane.` }
  }).catch(() => ({ result: 'assumption-check could not log that; carry on without it.' }))


  // A desktop draws each Button as a native button of its own label alone:
  // colors, bold and spacing inside one are lost. So every styled part here
  // is a Text beside a Button, and the Buttons hold one plain word or glyph.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Mobile draws no Input: there "wrong" always lets Claude ask.
    const Input = 'Input' in elements ? elements.Input : undefined
    const on_ = await capturing($, startOn)
    const allGroups = await read($, groups)
    const all = await read($, cards)
    const open = new Set(await read($, expanded))
    const picked = await read($, selected)
    const fix = await read($, fixing)
    const only = await read($, filter)
    const shown = only === null ? all : all.filter(MATCHES[only])

    // One line, cut with an ellipsis where the pane ends. A flex item is as
    // wide as its text unless its minimum is 0, so without it the text
    // overruns the card instead of being cut.
    const line = (text: string, props: Record<string, unknown> = {}) => (
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text wrap="truncate-end" {...props}>
          {text}
        </Text>
      </Box>
    )
    // A label beside a line, kept whole: it never shrinks or wraps.
    const fixed = (text: string, props: Record<string, unknown> = {}) => (
      <Box flexShrink={0}>
        <Text {...props}>{text}</Text>
      </Box>
    )

    const header = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text color={on_ ? 'success' : undefined} dimColor={!on_}>
          {on_ ? '● capture on' : '○ capture off'}
        </Text>
        <Button key="toggle" label={on_ ? 'turn off' : 'turn on'} onPress={() => void (on_ ? turnOff($) : turnOn($))} />
      </Box>
    )

    // The counts are over every card, whatever the filter shows. A box's label
    // filters to its cards; pressed again, it shows them all.
    const stat = (which: Filter, label: string, color: string) => {
      const n = all.filter(MATCHES[which]).length
      const isActive = only === which
      return (
        <Box
          key={`stat-${which}`}
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={isActive ? color : 'subtle'}
          hover={{ borderColor: color }}
          paddingX={1}
        >
          <Button key={`filter-${which}`} label={label} plain dimColor={!isActive} onPress={() => void update($, filter, f => (f === which ? null : which))} />
          <Text bold color={n > 0 ? color : undefined} dimColor={n === 0}>
            {String(n)}
          </Text>
        </Box>
      )
    }
    const stats = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {stat('open', 'To check', 'warning')}
        {stat('low', 'Low confidence', 'error')}
        {stat('marked', 'Corrected', 'suggestion')}
        {stat('confirmed', 'Confirmed', 'success')}
      </Box>
    )

    const field = (label: string, value: string) => (
      <Box flexDirection="column">
        <Text dimColor>{label}</Text>
        <Text>{value}</Text>
      </Box>
    )

    const card = (c: Card) => {
      const isPicked = picked === c.id
      const isOpen = c.status === 'open'
      const isWrong = c.status === 'wrong' || c.status === 'corrected'
      return (
        <Box
          key={`row-${c.id}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={isOpen && isPicked ? 'text' : BORDER[c.status]}
          {...(isOpen && !isPicked ? { hover: { borderColor: 'text' } } : {})}
          paddingX={1}
          gap={isPicked ? 1 : 0}
        >
          <Box flexDirection="row" gap={1}>
            <Button key={`card-${c.id}`} label={isPicked ? '▾' : '▸'} plain onPress={() => void update($, selected, () => (isPicked ? null : c.id))} />
            {!isOpen && fixed(MARK[c.status], { color: isWrong ? 'error' : 'success' })}
            {fixed(c.id, { dimColor: true })}
            {fixed(`● ${c.confidence}`, { color: CONFIDENCE_COLOR[c.confidence] })}
            {isPicked && fixed(`· ${c.category}`, { dimColor: true })}
            {!isPicked && line(c.statement, { strikethrough: isWrong, dimColor: !isOpen })}
          </Box>
          {isPicked && (
            <Text bold strikethrough={isWrong}>
              {c.statement}
            </Text>
          )}
          {c.correction !== undefined && <Text color="suggestion">→ {c.correction}</Text>}
          {isPicked && c.status === 'wrong' && <Text color="error">marked wrong · Claude asks you what's right</Text>}
          {isPicked && c.why !== '' && field('Why', c.why)}
          {isPicked && c.impact !== '' && field('If wrong', c.impact)}
          {isPicked && c.source !== undefined && (
            <Box flexDirection="column">
              <Text dimColor>Source</Text>
              <Button key={`source-${c.id}`} label={c.source} plain onPress={() => void openSource($, c.source ?? '')} />
            </Box>
          )}
          {isPicked && (
            <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
              {isOpen && <Button key={`right-${c.id}`} label="right" hotkey="r" variant="primary" onPress={() => void confirm($, [c.id])} />}
              {isOpen && (
                <Button
                  key={`wrong-${c.id}`}
                  label="wrong"
                  hotkey="w"
                  onPress={() => void (Input === undefined ? markWrong($, c, '') : update($, fixing, () => (fix === c.id ? null : c.id)))}
                />
              )}
              {isOpen && <Button key={`why-${c.id}`} label="why?" hotkey="y" onPress={() => void $.prompt.submit({ text: say.why(c) })} />}
              {c.status === 'confirmed' && (
                <Button key={`undo-${c.id}`} label="undo" hotkey="u" onPress={() => void setCard($, c.id, x => ({ ...x, status: 'open' }))} />
              )}
              <Box flexGrow={1} />
              <Button key={`delete-${c.id}`} label="delete" hotkey="d" plain dimColor onPress={() => void remove($, c)} />
            </Box>
          )}
          {isPicked && fix === c.id && isOpen && Input !== undefined && (
            <Input
              key={`fix-${c.id}`}
              label="right assumption:"
              placeholder="leave empty and Claude asks you"
              submitLabel="send"
              autoFocus
              onSubmit={(value: string) => void markWrong($, c, value)}
            />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {all.length > 0 && stats}
        {all.length === 0 && (
          <Text dimColor>
            {on_ ? 'No assumptions yet. They show here as Claude logs them.' : 'Capture is off, so Claude works as without this mod. Turn it on to see its assumptions.'}
          </Text>
        )}
        {all.length > 0 && shown.length === 0 && <Text dimColor>None here. Press the box again to show every card.</Text>}
        {[...allGroups].reverse().map(group => {
          const mine = shown.filter(c => c.group === group.id)
          if (mine.length === 0) return null
          const toCheck = all.filter(c => c.group === group.id && c.status === 'open')
          // "all right" confirms only what the filter shows.
          const visible = mine.filter(c => c.status === 'open')
          // A filter shows what it found, folded prompts included.
          const isOpen = only !== null || open.has(group.id)
          return (
            <Box key={`group-${group.id}`} flexDirection="column" gap={1}>
              <Box flexDirection="row" gap={1} alignItems="center">
                <Button
                  key={`toggle-${group.id}`}
                  label={isOpen ? '▾' : '▸'}
                  plain
                  onPress={() => void update($, expanded, list => (list.includes(group.id) ? list.filter(id => id !== group.id) : [...list, group.id]))}
                />
                {fixed(group.id, { bold: true })}
                {line(group.label)}
                {toCheck.length > 0 ? fixed(`${toCheck.length} to check`, { color: 'warning' }) : fixed('· all checked', { dimColor: true })}
                {visible.length > 0 && <Button key={`all-right-${group.id}`} label="all right" onPress={() => void confirm($, visible.map(c => c.id))} />}
              </Box>
              {isOpen && (
                <Box flexDirection="column" paddingLeft={2} gap={1}>
                  {ordered(mine).map(card)}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
