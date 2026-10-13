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
const STATUS_WORD: Record<Status, string> = { open: 'to check', wrong: '✗ marked wrong', corrected: '✎ corrected', confirmed: '✓ confirmed' }
// What each count box's filter keeps, as its hover card says it.
const RULE_OF: Record<Filter, Line> = {
  open: 'Open cards, not yet marked right or wrong',
  low: [{ t: 'Open cards Claude logged at ', s: 'd' }, { t: 'low confidence', s: 'bad' }],
  marked: 'Cards marked wrong, with a fix typed or not',
  confirmed: 'Cards marked right',
}

// The hover cards' colors, as changes-drill draws them.
const CARD = '#34332f'
const FG = '#e9e7e2'
const DIM = '#9c9a94'
const FAINT = '#6f6d68'
const GOOD = '#7fc97f'
const BAD = '#ef8a80'
const WARN = '#e7c06b'
const ACCENT = '#8db4f0'
const CHIP = '#ffffff1f'

// Card text: a line is a string or a list of pieces; a piece is a string
// (plain) or text with a style. The first line is bold, a plain string after
// it dim. A card's tone colors the bar down its left edge on the desktop and
// its border in the terminal: action for a press that stays local, warn for
// one that reaches Claude, danger for one that destroys, info for the rest.
type Style = 'b' | 'd' | 'f' | 'i' | 'good' | 'bad' | 'warn' | 'accent' | 'key' | 'tag' | 'tag-good' | 'tag-bad' | 'tag-warn'
type Piece = string | { t: string; s: Style }
type Line = string | Piece[]
type Tone = 'action' | 'info' | 'warn' | 'danger' | 'good'
const TONES: Record<Tone, string> = { action: ACCENT, info: FAINT, warn: WARN, danger: BAD, good: GOOD }
const TINT: Partial<Record<Style, [string, string]>> = {
  'tag-good': [GOOD, '#7fc97f26'],
  'tag-bad': [BAD, '#ef8a8026'],
  'tag-warn': [WARN, '#e7c06b26'],
  tag: [FG, CHIP],
  key: [FG, CHIP],
}
const PAINT: Partial<Record<Style, string>> = { d: DIM, f: FAINT, good: GOOD, bad: BAD, warn: WARN, accent: ACCENT }
const SEP = { t: ' · ', s: 'f' } as const
const key = (letter: string) => ({ t: letter, s: 'key' }) as const
const PROMPT_TAG = { t: 'sends a prompt', s: 'tag-warn' } as const
const STATUS_TONE: Record<Status, Tone> = { open: 'info', wrong: 'danger', corrected: 'warn', confirmed: 'good' }
const STATUS_STYLE: Record<Status, Style> = { open: 'd', wrong: 'bad', corrected: 'warn', confirmed: 'good' }

// The folder dim, the file name bold.
const pathPieces = (path: string): Piece[] => {
  const i = path.lastIndexOf('/')
  return i < 0 ? [{ t: path, s: 'b' }] : [{ t: path.slice(0, i + 1), s: 'd' }, { t: path.slice(i + 1), s: 'b' }]
}
// Text with its ids (A1, P2) bold and the rest dim.
const idPieces = (text: string): Piece[] =>
  text
    .split(/\b([AP]\d+)\b/)
    .map((part, i) => ({ t: part, s: i % 2 === 1 ? ('b' as const) : ('d' as const) }))
    .filter(p => p.t !== '')
// How many cells a line takes: a chip pads its text with a space each side.
const lineLength = (line: Line): number =>
  typeof line === 'string' ? line.length : line.reduce((n, p) => n + (typeof p === 'string' ? p.length : p.t.length + (TINT[p.s] ? 2 : 0)), 0)
// Pieces cut to `max` characters, the last one ending in an ellipsis.
function clip(pieces: Piece[], max: number): Piece[] {
  const out: Piece[] = []
  let n = 0
  for (const p of pieces) {
    const text = typeof p === 'string' ? p : p.t
    if (n + text.length > max) {
      const rest = `${text.slice(0, Math.max(0, max - n - 1))}…`
      out.push(typeof p === 'string' ? rest : { ...p, t: rest })
      return out
    }
    out.push(p)
    n += text.length
  }
  return out
}

// One line of a card: its pieces as nested Text, so it stays one line.
function cardLine(Text: any, line: Line, i: number) {
  const pieces: Piece[] = typeof line === 'string' ? [{ t: line, s: i === 0 ? 'b' : 'd' }] : line
  return (
    <Text key={`l${i}`} wrap="wrap" bold={i === 0} color={FG}>
      {pieces.map((p, j) => {
        if (typeof p === 'string') return p
        const tint = TINT[p.s]
        if (tint)
          return (
            <Text key={j} color={tint[0]} backgroundColor={tint[1]} bold={p.s === 'key'}>
              {` ${p.t} `}
            </Text>
          )
        return (
          <Text key={j} bold={p.s === 'b'} italic={p.s === 'i'} color={PAINT[p.s]}>
            {p.t}
          </Text>
        )
      })}
    </Text>
  )
}

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

// A card's list of ids, cut where it would run past `max` characters.
function idList(ids: readonly string[], max = 80): string {
  const all = ids.join(', ')
  return all.length > max ? `${all.slice(0, max - 1).replace(/,? *[^,]*$/, '')}, …` : all
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
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

// A prompt the pane folded to fit, opened alone: the others fold and the
// filter clears, so it is the one prompt drawn open.
async function openAlone($: EngineInterface, id: string) {
  await update($, expanded, () => [id])
  await update($, filter, () => null)
}

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The pane draws at
// the richest level that fits: 0 every card, 1 action and status cards only,
// 2 no cards, 3 the open prompts past the newest two folded, 4 only the
// newest open prompt, with MAX_ROWS of its cards at most.
export const BUDGET = 1000
// Characters of the serialized tree, an inline SVG's source included.
export const CHAR_BUDGET = 200_000
// The level with no cards: the terminal's (see fit).
export const NO_CARDS = 2
export const TOP_LEVEL = 4
export const MAX_ROWS = 15
// Elements in a tree, counted as the live measure counted them.
export function countNodes(tree: unknown): number {
  let nodes = 0
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    nodes += 1
    walk(n.children)
    walk(n.props?.children)
  }
  walk(tree)
  return nodes
}
// Draws at level 0, then 1, 2, ... until the tree fits or `top` is reached.
// Only the desktop (and VS Code) has the limit. The terminal draws no hover
// cards at all, its folds left out: level NO_CARDS.
export function fit<T>(surface: string, top: number, draw: (level: number) => T): T {
  if (surface === 'terminal') return draw(NO_CARDS)
  if (surface !== 'desktop' && surface !== 'vscode') return draw(0)
  let tree = draw(0)
  for (let level = 1; level <= top && (countNodes(tree) > BUDGET || JSON.stringify(tree).length > CHAR_BUDGET); level += 1) tree = draw(level)
  return tree
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
    const term = e.surface === 'terminal'
    const cols = e.props.bodyColumns || 60

    // The pane at a level of the ladder (see BUDGET).
    const draw = (level: number) => {
      // Whether a card of `tone` is drawn at this level: none on a phone,
      // which has no hover.
      const shows = (tone: Tone) => e.surface !== 'mobile' && (level <= 0 || (level === 1 && tone !== 'info'))
      // A hover card: hidden, shown while its host (the nearest keyed Box, or
      // the boxes of `scope`) is hovered, placed by `at` in whole cells. The
      // first line is the action or the headline, the rest dim, and every line
      // wraps. A phone has no hover, so it gets none. One row clear of its host:
      // a pointer leaving the host crosses that row, so the card closes instead
      // of holding the pointer over what it covers. Its tone is a bar down the
      // left edge on the desktop, the border's color in the terminal.
      const tip = (lines: Line[], at: { top?: number; bottom?: number; left?: number; right?: number }, width = 48, scope?: string, tone: Tone = 'info') =>
        !shows(tone) ? null : (
          <Box
            position="absolute"
            {...at}
            top={at.top === undefined ? undefined : at.top + 1}
            bottom={at.bottom === undefined ? undefined : at.bottom + 1}
            display="none"
            hover={scope === undefined ? { display: 'flex' } : { scope, display: 'flex' }}
            flexDirection="row"
            backgroundColor={CARD}
            paddingX={0}
            paddingY={term ? 0 : 0.3}
            width={Math.max(12, Math.min(48, width))}
            borderStyle={term ? 'round' : undefined}
            borderColor={term ? TONES[tone] : undefined}
          >
            {!term && <Box width={0.25} backgroundColor={TONES[tone]} />}
            <Box flexDirection="column" paddingX={0.75} flexShrink={1} minWidth={0}>
              {lines.map((one, i) => cardLine(Text, one, i))}
            </Box>
          </Box>
        )
      // A one-card-line tip as wide as its longest line, border and padding in.
      const snug = (lines: Line[]) => Math.max(...lines.map(lineLength)) + 4

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

      // Turning it off stops Claude logging; turning it on stays local.
      const captureTone: Tone = on_ ? 'danger' : 'action'
      const header = (
        <Box flexDirection="row" gap={1} flexWrap="wrap" hover={shows(captureTone) ? { scope: 'tip:capture', backgroundColor: '#ffffff10' } : undefined}>
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
            hover={shows('action') ? { borderColor: color, backgroundColor: '#ffffff10', scope: `tip:stat-${which}` } : { borderColor: color }}
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

      // The cards of the header and the count boxes. Above them the pane ends,
      // so each opens downward, drawn last in the pane to paint over the rows
      // below, and its host lights it through a scope. A downward card stays
      // open while the pointer is on it, so it keeps to the right 60% of the
      // pane and leaves the labels on the left free to move down. Which line a
      // box sits on is worked out as the row lays them: each as wide as its
      // label, wrapped to the pane.
      const downWidth = Math.min(48, Math.max(24, Math.round(cols * 0.6)))
      const STATS: [Filter, string][] = [
        ['open', 'To check'],
        ['low', 'Low confidence'],
        ['marked', 'Corrected'],
        ['confirmed', 'Confirmed'],
      ]
      const bands: { which: Filter; width: number }[][] = [[]]
      let used = 0
      for (const [which, label] of STATS) {
        const width = label.length + 4 + (term ? 0 : 1.5)
        const band = bands.at(-1)!
        if (band.length > 0 && used + 1 + width > cols) {
          bands.push([{ which, width }])
          used = width
        } else {
          band.push({ which, width })
          used += (band.length > 1 ? 1 : 0) + width
        }
      }
      const statCards = bands.flatMap((band, row) =>
        band.map(({ which }) => {
          const ids = all.filter(MATCHES[which]).map(c => c.id)
          const isActive = only === which
          // The ids by prompt, newest first, as the pane lists them.
          const byPrompt = [...allGroups]
            .reverse()
            .map(g => [g.id, all.filter(c => c.group === g.id && MATCHES[which](c)).map(c => c.id)] as const)
            .filter(([, mine]) => mine.length > 0)
            .flatMap(([g, mine], i): Piece[] => [...(i > 0 ? [SEP] : []), ...idPieces(`${g}: ${idList(mine, 40)}`)])
          // Two wrapped lines at most, so the card keeps to four.
          const most = 2 * (downWidth - 4) - 1
          return tip(
            [
              isActive ? 'Shows every card again' : ids.length === 0 ? 'Shows none: no such card yet' : `Shows only these ${plural(ids.length, 'card')}`,
              RULE_OF[which],
              ...(byPrompt.length > 0 ? [lineLength(byPrompt) > most ? clip(byPrompt, most) : byPrompt] : []),
            ],
            { top: 2 + row * 4 + 3, right: 0 },
            downWidth,
            `tip:stat-${which}`,
            'action',
          )
        }),
      )

      // A pane is only as tall as its tree on the desktop, so a downward card
      // that runs past the last row is cut into a scroll. Under a short tree,
      // room is left for the lowest card: a reckoning of the rows each part
      // takes, a card row 3 and its gap.
      const reach = all.length === 0 ? 6 : 2 + (bands.length - 1) * 4 + 3 + 5
      let rows = all.length === 0 ? 4 : 2 + bands.length * 4 + (shown.length === 0 ? 2 : 0)
      for (const g of allGroups) {
        const n = shown.filter(c => c.group === g.id).length
        if (n > 0) rows += 2 + (only !== null || open.has(g.id) ? 4 * n + 1 : 0)
      }
      const room = e.surface === 'mobile' || level >= 2 || reach - rows - 1 <= 0 ? null : <Box key="tip-room" height={reach - rows - 1} flexShrink={0} />

      const field = (label: string, value: string) => (
        <Box flexDirection="column">
          <Text dimColor>{label}</Text>
          <Text>{value}</Text>
        </Box>
      )

      // A folded card's hover card: what ▸ opens to, then what the row cuts or
      // hides. It opens over the rows above, past the card's own border and
      // correction. The first card of a prompt has the prompt's row above, with
      // ▸ at the left and "all right" at the right, so its card sits between.
      const peek = (c: Card, isFirst: boolean) => {
        const isOpen = c.status === 'open'
        const hostWidth = cols - 2
        const width = Math.min(48, isFirst ? hostWidth - 18 : hostWidth - 5)
        const inner = width - 4
        // What the row has for the statement after ▸, the mark, the id and the confidence.
        const room = hostWidth - 6 - (isOpen ? 0 : 2) - (c.id.length + 1) - (c.confidence.length + 3)
        const info: Line[] = []
        let rows = 0
        if (c.statement.length > room) {
          const text = c.statement.length > 2 * inner - 4 ? `${c.statement.slice(0, 2 * inner - 5)}…` : c.statement
          info.push([{ t: text, s: 'i' }])
          rows += text.length > inner ? 2 : 1
        }
        const meta = [
          ...(isOpen ? [] : [[{ t: STATUS_WORD[c.status], s: STATUS_STYLE[c.status] }] as Piece[]]),
          [c.category] as Piece[],
          ...(c.source === undefined ? [] : [pathPieces(c.source)]),
        ].flatMap((part, i) => (i > 0 ? [SEP, ...part] : part))
        const why: Piece[] | '' = c.why && [{ t: 'Why: ', s: 'd' }, c.why]
        const impact: Piece[] | '' = c.impact && [{ t: 'If wrong: ', s: 'd' }, c.impact]
        for (const more of [why, impact, meta]) {
          if (more && rows < 4) {
            info.push(more)
            rows++
          }
        }
        // Each action's hotkey a chip right after it, in fewer words to fit them.
        const action: Piece[] = isOpen
          ? ['▸ opens, then right', key('r'), SEP, 'wrong', key('w'), SEP, 'why?', key('y')]
          : c.status === 'confirmed'
            ? ['▸ opens, then undo', key('u'), SEP, 'delete', key('d')]
            : ['▸ opens, then delete', key('d')]
        const rise = 3 + (c.correction === undefined ? 0 : Math.ceil((c.correction.length + 2) / (hostWidth - 4)))
        return tip([action, ...info], isFirst ? { bottom: rise, left: 4 } : { bottom: rise, right: 0 }, width, undefined, STATUS_TONE[c.status])
      }

      // An action's card sits on the body text above the buttons: past the
      // source, a button of its own, when the card has one.
      const act = (c: Card, which: string, button: unknown, lines: Line[], tone: Tone, side: 'left' | 'right' = 'left') => {
        const rise = c.source === undefined ? 1 : 4
        return (
          <Box key={`tip:${which}-${c.id}`}>
            {button}
            {tip(lines, side === 'left' ? { bottom: rise, left: 0 } : { bottom: rise, right: 0 }, snug(lines), undefined, tone)}
          </Box>
        )
      }

      const card = (c: Card, isFirst: boolean) => {
        const isPicked = picked === c.id
        const isOpen = c.status === 'open'
        const isWrong = c.status === 'wrong' || c.status === 'corrected'
        const lit = !isPicked && shows(STATUS_TONE[c.status]) ? { backgroundColor: '#ffffff10' } : undefined
        return (
          <Box
            key={`row-${c.id}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={isOpen && isPicked ? 'text' : BORDER[c.status]}
            {...(isPicked ? {} : isOpen ? { hover: { borderColor: 'text', ...lit } } : lit === undefined ? {} : { hover: lit })}
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
                {isOpen &&
                  act(
                    c,
                    'right',
                    <Button key={`right-${c.id}`} label="right" hotkey="r" variant="primary" onPress={() => void confirm($, [c.id])} />,
                    [['Confirms it', key('r'), SEP, "Claude isn't told"], 'undo puts it back to check'],
                    'action',
                  )}
                {isOpen &&
                  act(
                    c,
                    'wrong',
                    <Button
                      key={`wrong-${c.id}`}
                      label="wrong"
                      hotkey="w"
                      onPress={() => void (Input === undefined ? markWrong($, c, '') : update($, fixing, () => (fix === c.id ? null : c.id)))}
                    />,
                    fix === c.id
                      ? [['Closes the field', key('w'), SEP, 'sends nothing']]
                      : [['Marks it wrong', key('w'), ' ', PROMPT_TAG], 'Type the fix in the field, or send it empty', 'Claude lists what relied on it first'],
                    // Closing the field stays local; marking it wrong reaches Claude.
                    fix === c.id ? 'action' : 'warn',
                  )}
                {isOpen &&
                  act(
                    c,
                    'why',
                    <Button key={`why-${c.id}`} label="why?" hotkey="y" onPress={() => void $.prompt.submit({ text: say.why(c) })} />,
                    [['Asks Claude why', key('y'), ' ', PROMPT_TAG], 'It says what led to it, changes nothing yet'],
                    'warn',
                  )}
                {c.status === 'confirmed' &&
                  act(
                    c,
                    'undo',
                    <Button key={`undo-${c.id}`} label="undo" hotkey="u" onPress={() => void setCard($, c.id, x => ({ ...x, status: 'open' }))} />,
                    [['Back to check', key('u'), SEP, "Claude isn't told"]],
                    'action',
                  )}
                <Box flexGrow={1} />
                {act(
                  c,
                  'delete',
                  <Button key={`delete-${c.id}`} label="delete" hotkey="d" plain dimColor onPress={() => void remove($, c)} />,
                  [
                    ['Removes the card', key('d'), SEP, "Claude isn't told"],
                    [{ t: 'Ids keep counting: ', s: 'd' }, { t: c.id, s: 'b' }, { t: ' is never reused', s: 'd' }],
                  ],
                  'danger',
                  'right',
                )}
              </Box>
            )}
            {!isPicked && peek(c, isFirst)}
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

      // The prompts listed, newest first: those with a card the filter shows.
      // Past level 2 the open ones after the newest two (level 3) or the
      // newest one (level 4) fold, a line above them saying so.
      const listed = [...allGroups].reverse().filter(g => shown.some(c => c.group === g.id))
      const keptOpen = level >= 4 ? 1 : level >= 3 ? 2 : Infinity
      const folded = new Set(listed.filter(g => only !== null || open.has(g.id)).slice(keptOpen).map(g => g.id))
      const firstFolded = listed.find(g => folded.has(g.id))?.id

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
          {listed.map(group => {
            const mine = shown.filter(c => c.group === group.id)
            const toCheck = all.filter(c => c.group === group.id && c.status === 'open')
            // "all right" confirms only what the filter shows.
            const visible = mine.filter(c => c.status === 'open')
            // A filter shows what it found, folded prompts included, unless
            // the pane folds them to fit.
            const isFolded = folded.has(group.id)
            const isOpen = (only !== null || open.has(group.id)) && !isFolded
            // Level 4 draws MAX_ROWS of the prompt's cards, the picked one among them.
            const list = ordered(mine)
            const more = level >= 4 ? Math.max(0, list.length - MAX_ROWS) : 0
            const drawn = more === 0 ? list : [...list.slice(0, MAX_ROWS - 1), list.slice(MAX_ROWS - 1).find(c => c.id === picked) ?? list[MAX_ROWS - 1]!]
            const ours = all.filter(c => c.group === group.id)
            // The row's three cards share one place: right of ▸, left of "all
            // right", over what is above, so neither control is ever covered.
            const width = Math.min(48, cols - 20)
            const breakdown = (
              [
                ['To check', 'open'],
                ['✗ Wrong', 'wrong'],
                ['✎ Corrected', 'corrected'],
                ['✓ Confirmed', 'confirmed'],
              ] as const
            ).flatMap(([label, status]) => {
              const ids = ours.filter(c => c.status === status).map(c => c.id)
              return ids.length > 0 ? [[{ t: `${label}: `, s: 'd' }, ...idPieces(idList(ids, 40))] as Piece[]] : []
            })
            const low = ours.filter(MATCHES.low).length
            return (
              <Box key={`group-${group.id}`} flexDirection="column" gap={1}>
                {group.id === firstFolded && (
                  <Text key="folded" dimColor>
                    {`${plural(folded.size, 'prompt')} folded to fit the pane · ▸ opens one alone${only === null ? '' : ', the filter cleared'}`}
                  </Text>
                )}
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Box key={`tip:toggle-${group.id}`}>
                    <Button
                      key={`toggle-${group.id}`}
                      label={isOpen ? '▾' : '▸'}
                      plain
                      onPress={() => void (isFolded ? openAlone($, group.id) : update($, expanded, ids => (ids.includes(group.id) ? ids.filter(id => id !== group.id) : [...ids, group.id])))}
                    />
                    {tip(
                      [`${open.has(group.id) ? 'Folds' : 'Unfolds'} ${group.id}'s ${plural(ours.length, 'card')}`, ...(only === null ? [] : ['A filter shows them either way'])],
                      { bottom: 1, left: 6 },
                      width,
                      undefined,
                      'action',
                    )}
                  </Box>
                  <Box
                    key={`ghead-${group.id}`}
                    flexDirection="row"
                    gap={1}
                    alignItems="center"
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    hover={shows('info') ? { backgroundColor: '#ffffff10' } : undefined}
                  >
                    {fixed(group.id, { bold: true })}
                    {line(group.label)}
                    {toCheck.length > 0 ? fixed(`${toCheck.length} to check`, { color: 'warning' }) : fixed('· all checked', { dimColor: true })}
                    {tip(
                      [[group.id, SEP, plural(ours.length, 'card'), ...(low > 0 ? [SEP, { t: `${low} low confidence`, s: 'bad' } as const] : [])], ...breakdown],
                      { bottom: 1, left: 4 },
                      width,
                    )}
                  </Box>
                  {visible.length > 0 && (
                    <Box key={`tip:all-right-${group.id}`}>
                      <Button key={`all-right-${group.id}`} label="all right" onPress={() => void confirm($, visible.map(c => c.id))} />
                      {tip(
                        [
                          [`Confirms ${plural(visible.length, 'open card')}`, SEP, "Claude isn't told"],
                          idPieces(idList(visible.map(c => c.id))),
                          ...(only === null ? [] : ['Only the ones the filter shows']),
                        ],
                        { bottom: 1, right: Math.max(0, cols - 6 - width) },
                        width,
                        undefined,
                        'action',
                      )}
                    </Box>
                  )}
                </Box>
                {isOpen && (
                  <Box flexDirection="column" paddingLeft={2} gap={1}>
                    {drawn.map((c, i) => card(c, i === 0))}
                    {more > 0 && (
                      <Text key="more" dimColor>
                        {`+${more} more in ${group.id}, folded to fit the pane · a count box above narrows them`}
                      </Text>
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
          {room}
          {tip(
            [
              on_ ? ['turn off: Claude stops logging', SEP, 'cards stay'] : 'turn on: Claude logs its assumptions here',
              on_ ? 'Its note_assumption tool adds the cards' : 'Off, Claude reads nothing of this mod',
              [plural(all.length, 'card'), { t: ' so far', s: 'd' }, SEP, { t: 'also ', s: 'd' }, '/assumption-check on', { t: ' or ', s: 'd' }, 'off'],
            ],
            { top: 1, right: 0 },
            downWidth,
            'tip:capture',
            captureTone,
          )}
          {all.length > 0 && statCards}
        </Box>
      )
    }
    return fit(e.surface, TOP_LEVEL, draw)
  })
}
