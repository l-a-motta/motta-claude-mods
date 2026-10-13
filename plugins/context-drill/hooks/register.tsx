// context-drill: a Context pane that drills into what fills the window.
//
// Read when the pane opens, on Refresh, and (by default) after each turn
// while the pane is shown; nothing is read while it is closed. The breakdown
// is the local `summary` one (no request sent), the transcript is the
// session's own, and the startup cost a few numbers in the plugin store.
// Top to bottom: the fill, the /context categories (a stacked bar with the
// auto-compact tick, a list or the grid) with what grew since the baseline, the fill after each turn, turns left before auto-compact with
// Compact now and focus presets, cache health, the heaviest messages, tokens
// by tool, the drill sections (memory files, MCP tools by server, agents,
// skills) and the startup cost against your average. Every part is a
// userConfig option. Opened by /context-drill, or by another mod through the
// noun this mod adds to `$`, `$.contextDrill.open()`: a mod opens only its own
// panes, so motta-statusline's ctx asks this one to.
//
// While the pane is closed, the fill the engine pushes after each turn
// (`session.measure`, no call made) still goes into the history, and the fill
// turning orange or red raises one toast.

import { atom, read, update } from 'claude-code'
import type { ContextDrillReading as Reading, EngineInterface, PluginOptions, Register, SessionContextBreakdown, SessionMessage } from 'claude-code'

import type { ContextDrillOpened, HeavyItem, Startup, ToolTotal } from '../types'
import { BAR_HEIGHT, barWidth, brailleRuns, gridSvg, type Segment, sparkSvg, sparkText, squaresSvg } from './bars.ts'

const PANE = 'context-drill'

const reading = atom({ plugin: 'context-drill', key: 'reading' } as const, null)
const history = atom({ plugin: 'context-drill', key: 'history' } as const, [])
const since = atom({ plugin: 'context-drill', key: 'since' } as const, null)
const folds = atom({ plugin: 'context-drill', key: 'folds' } as const, {})
const alerted = atom({ plugin: 'context-drill', key: 'alerted' } as const, 0)
const startupTokens = atom({ plugin: 'context-drill', key: 'startupTokens' } as const, null)
const focus = atom({ plugin: 'context-drill', key: 'focus' } as const, 'none')

// The fill after each turn kept, at most.
const HISTORY_KEPT = 48
// Startup costs kept per store key, at most.
const STARTUPS_KEPT = 30

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The pane draws at
// the richest level that fits: 0 every card, 1 action and status cards only,
// 2 no cards, 3 open drill sections list at most 10 items, 4 at most 5 and
// the heaviest and by-tool lists 3 rows, 5 every drill section folded.
export const BUDGET = 1000
// Characters of the serialized tree, an inline SVG's source included.
export const CHAR_BUDGET = 200_000
export const TOP_LEVEL = 5
// The items an open drill section lists at levels 3 and 4, at most; the
// heaviest and by-tool rows at level 4.
const FITTED_ITEMS = [10, 5]
const FITTED_ROWS = 3
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
// Only the desktop (and VS Code) has the limit: the terminal keeps level 0.
export function fit<T>(surface: string, top: number, draw: (level: number) => T): T {
  if (surface !== 'desktop' && surface !== 'vscode') return draw(0)
  let tree = draw(0)
  for (let level = 1; level <= top && (countNodes(tree) > BUDGET || JSON.stringify(tree).length > CHAR_BUDGET); level += 1) tree = draw(level)
  return tree
}

export type Config = {
  barWidth: number
  categories: 'stacked' | 'list' | 'grid' | 'off'
  categoryOrder: 'engine' | 'size'
  categoryHide: number
  thresholdToast: boolean
  history: number
  historyGrowth: boolean
  forecast: 'average' | 'recent' | 'off'
  since: 'open' | 'compact' | 'off'
  cache: 'bar' | 'text' | 'off'
  heaviest: number
  heaviestKind: 'all' | 'tools'
  byTool: number
  byToolCalls: boolean
  sectionsFolded: 'mcp' | 'none' | 'all'
  sectionsMax: number
  paths: 'full' | 'home' | 'name'
  compactActions: 'presets' | 'now'
  baseline: 'project' | 'all' | 'off'
  numbers: 'k' | 'comma' | 'percent'
  refresh: 'turn' | 'manual'
}

// The manifest's userConfig values, each defaulting to its manifest default
// when absent or not a string.
export function config(o: PluginOptions): Config {
  const s = <T extends string>(key: string, fallback: T): T => (typeof o[key] === 'string' ? (o[key] as T) : fallback)
  const n = (key: string, fallback: string, off = 0) => {
    const v = s(key, fallback)
    return v === 'off' ? off : v === 'all' || v === 'fit' ? Infinity : Number(v)
  }
  return {
    barWidth: n('barWidth', 'fit'),
    categories: s('categories', 'stacked'),
    categoryOrder: s('categoryOrder', 'engine'),
    categoryHide: n('categoryHide', '0'),
    thresholdToast: s('thresholdToast', 'once') === 'once',
    history: n('history', '24'),
    historyGrowth: s('historyGrowth', 'on') === 'on',
    forecast: s('forecast', 'average'),
    since: s('since', 'open'),
    cache: s('cache', 'bar'),
    heaviest: n('heaviest', '5'),
    heaviestKind: s('heaviestKind', 'all'),
    byTool: n('byTool', '4'),
    byToolCalls: s('byToolCalls', 'on') === 'on',
    sectionsFolded: s('sectionsFolded', 'mcp'),
    sectionsMax: n('sectionsMax', 'all'),
    paths: s('paths', 'full'),
    compactActions: s('compactActions', 'presets'),
    baseline: s('baseline', 'project'),
    numbers: s('numbers', 'k'),
    refresh: s('refresh', 'turn'),
  }
}

export const register: Register = (on, options) => {
  const cfg = config(options)

  // The noun's own answer is the bottom of its event; the hook on
  // `contextDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, contextDrill: { open: async (): Promise<ContextDrillOpened> => ({ isPlaced: false, reason: 'context-drill did not answer the call' }) } }
  })

  on('contextDrill.open', async $ => ({ value: await open($, cfg) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-drill', description: 'Drill into what fills the context window' })
    return next(e)
  })

  on('command.run', { command: 'context-drill' }, async $ => {
    const opened = await open($, cfg)
    return { text: opened.isPlaced ? 'Context pane opened.' : `Context pane waits: ${opened.reason ?? 'not placed'}` }
  })

  // The figures the engine pushes after each turn: kept and toasted with no
  // call made; then, when refresh is per turn and the pane is shown, a read.
  if (cfg.history > 0 || cfg.thresholdToast || cfg.refresh === 'turn') {
    on('session.measure', async ($, e, next) => {
      const measured = await next(e)
      const tokens = e.context.tokens
      if (!e.changed.includes('context') || tokens === undefined) return measured
      if (cfg.history > 0) await update($, history, h => [...h, tokens].slice(-HISTORY_KEPT))
      if (cfg.thresholdToast && e.context.percent !== undefined) {
        const level = fillLevel(e.context.percent)
        const was = await read($, alerted)
        if (level > was && level >= 2) $.ui.toast(`Context passed ${LEVEL_FROM[level]}% · ${short(tokens)} of ${short(e.context.window)}`, { timeoutMs: 8_000 })
        if (level !== was) await update($, alerted, () => level)
      }
      if (cfg.refresh === 'turn' && (await $.ui.panes()).some(p => p.id === PANE && p.isShown)) await readAll($, cfg, false)
      return measured
    })
  }

  // A compaction of the main conversation starts the baseline over: the next
  // read takes it.
  if (cfg.since === 'compact') {
    on('session.compact', async ($, e, next) => {
      const compacted = await next(e)
      if (e.agentId === undefined && compacted.skip === undefined) await update($, since, () => null)
      return compacted
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const r = await read($, reading)
    const folded = await read($, folds)
    const chosen = await read($, focus)
    // A desktop tab not yet laid out comes without a width: assume a docked one.
    const columns = e.props.bodyColumns > 0 ? e.props.bodyColumns : 60
    // The richest level that fits the desktop's element limit.
    return fit(e.surface, TOP_LEVEL, level => contextPane($, els, r, folded, chosen, columns, cfg, e.surface, level))
  })
}

async function open($: EngineInterface, cfg: Config): Promise<ContextDrillOpened> {
  await readAll($, cfg, true)
  const opened = await $.ui.open({ id: PANE, title: 'Context' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

// One reading: the summary breakdown, the turns, the transcript's heavy items
// when a part draws them, the baseline and the startup cost. A failed read
// leaves the last one standing.
async function readAll($: EngineInterface, cfg: Config, isOpening: boolean) {
  try {
    const usage = (await $.session.usage({ breakdown: 'summary' })).context
    const turns = await $.session.turns()
    const b = usage.breakdown
    let heavy: HeavyItem[] = []
    let tools: ToolTotal[] = []
    if (cfg.heaviest > 0 || cfg.byTool > 0) ({ heavy, tools } = transcriptWeights(await $.session.messages()))
    const now = b ? categoryTokens(b) : null
    let base = await read($, since)
    if (cfg.since !== 'off' && now !== null && (base === null || (cfg.since === 'open' && isOpening))) {
      base = now
      await update($, since, () => now)
    }
    const startup = cfg.baseline !== 'off' && b ? await keepStartup($, b, cfg) : null
    const r: Reading = { usage, turns, readAt: await $.clock.now(), history: await read($, history), heavy, tools, startup, since: cfg.since === 'off' ? null : base }
    await update($, reading, () => r)
  } catch {
    // The last reading stays.
  }
}

async function compactNow($: EngineInterface, instructions = '') {
  await $.ui.close({ id: PANE })
  try {
    await $.command.run({ command: 'compact', args: instructions })
  } catch {
    $.ui.toast(instructions ? `Run /compact ${instructions}` : 'Run /compact to compact now')
  }
}

const PRESETS = [
  { key: 'keep-task', label: 'Keep current task', instructions: 'Keep the current task in full: what is being built, the files being changed, and what is left to do.' },
  { key: 'keep-decisions', label: 'Keep decisions', instructions: 'Keep every decision made and the reason for it, and what the user asked for or ruled out.' },
]

// The tokens of each category in use, by name: what a baseline holds.
export function categoryTokens(b: Pick<SessionContextBreakdown, 'categories'>): Record<string, number> {
  return Object.fromEntries(b.categories.filter(c => c.kind === 'used').map(c => [c.name, c.tokens]))
}

// What the context costs before a message: every category in use but
// Messages, as the first read found it (deferred tools loading later do not
// move it). Kept once per session under both scopes' keys, so either scope
// has it; compared with the earlier sessions' under the configured one.
async function keepStartup($: EngineInterface, b: SessionContextBreakdown, cfg: Config): Promise<Startup> {
  const kept = await read($, startupTokens)
  const tokens = kept ?? b.categories.filter(c => c.kind === 'used' && c.name !== 'Messages').reduce((n, c) => n + c.tokens, 0)
  const id = await $.session.id()
  const projectKey = `startup:${await $.session.root()}`
  const lists: Record<string, { id: string; tokens: number }[]> = {}
  for (const key of [projectKey, 'startup:all']) {
    const list = ((await $.store.get(key)) as { id: string; tokens: number }[] | undefined) ?? []
    lists[key] = list
    if (kept === null) await $.store.set(key, [...list.filter(x => x.id !== id), { id, tokens }].slice(-STARTUPS_KEPT))
  }
  if (kept === null) await update($, startupTokens, () => tokens)
  const others = (lists[cfg.baseline === 'all' ? 'startup:all' : projectKey] ?? []).filter(x => x.id !== id)
  return { tokens, average: others.length ? others.reduce((n, x) => n + x.tokens, 0) / others.length : null, sessions: others.length }
}

// The transcript's items by estimated tokens (about four characters to a
// token, counted here, nothing sent), the largest HEAVY_KEPT kept, and the
// tool results summed per tool.
export function transcriptWeights(messages: readonly SessionMessage[]): { heavy: HeavyItem[]; tools: ToolTotal[] } {
  const items: HeavyItem[] = []
  const byTool = new Map<string, ToolTotal>()
  for (const m of messages) {
    if (m.text) items.push({ who: m.role === 'user' ? 'You' : 'Claude', what: oneLine(m.text), tokens: estimate(m.text), isTool: false })
    for (const u of m.toolUses ?? []) {
      const tool = u.tool.replace(/^mcp__/, '')
      const tokens = estimate(u.text ?? '') + estimate(JSON.stringify(u.input ?? {}))
      items.push({ who: tool, what: describe(u.input ?? {}), tokens, isTool: true })
      const t = byTool.get(tool) ?? { tool, tokens: 0, calls: 0 }
      byTool.set(tool, { tool, tokens: t.tokens + tokens, calls: t.calls + 1 })
    }
  }
  const heavy = [...items.filter(i => i.isTool).sort(byTokens).slice(0, HEAVY_KEPT), ...items.filter(i => !i.isTool).sort(byTokens).slice(0, HEAVY_KEPT)].sort(byTokens)
  return { heavy, tools: [...byTool.values()].sort(byTokens) }
}

const HEAVY_KEPT = 5
const byTokens = (a: { tokens: number }, b: { tokens: number }) => b.tokens - a.tokens
const estimate = (text: string) => Math.ceil(text.length / 4)

// What a tool call was about: its path's file name, its command, pattern,
// query or the like, on one line.
const ABOUT = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'query', 'url', 'skill', 'description', 'prompt', 'subagent_type']
function describe(input: Record<string, unknown>) {
  for (const key of ABOUT) {
    const v = input[key]
    if (typeof v !== 'string' || !v) continue
    return key.endsWith('path') ? basename(v) : oneLine(v)
  }
  return ''
}

function oneLine(text: string, max = 60) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function basename(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

// The fill's level on motta-statusline's ctx scale: green under 30%, yellow
// from it, orange from 50%, red from 70%. A toast says when it turns orange
// or red, as the status line's does for a rate limit.
export function fillLevel(percent: number) {
  return percent >= 70 ? 3 : percent >= 50 ? 2 : percent >= 30 ? 1 : 0
}

const LEVEL_FROM = [0, 30, 50, 70]
// The theme has no orange key; a raw color draws the same on every theme.
const LEVEL_COLORS = ['success', 'warning', '#ff8700', 'error']

type Els = ReturnType<EngineInterface['ui']['resolve']>
type Reveal = (id: string, lines: (Line | null)[], top: number, tone?: Tone) => { scope: string; backgroundColor?: string } | undefined

// The table every section shares: a label that takes the room left and
// truncates, then a mini bar of MINI_BLOCKS blocks, then the figure right-
// aligned in a column VALUE_CELLS wide, so every bar and figure in the pane
// lines up. Items sit INDENT cells in, under their heading's title.
const MINI_BLOCKS = 8
// The desktop's bars drawn larger than the status line's: the category bar
// twice its squares' size, the mini bars half again.
const CATEGORY_SCALE = 2
const MINI_SCALE = 1.5
const VALUE_CELLS = 16
const INDENT = 2
// A desktop Button pads its label about this much on each side, in cells; a
// negative margin of it puts the label where plain text would sit.
const DESKTOP_BUTTON_PAD = 0.75
// How wide a desktop cell is, in CSS pixels, at most: the fitted bar is
// drawn this wide and, absent a width, shrinks to the pane's body.
const DESKTOP_CELL_PX = 10
// The hover cards: their ground and their text's colors. A card is at most
// TIP_CELLS wide and opens upward; one that could cover a fold heading
// (within HEAD_CELLS of the left) stays right of it, and where the pane
// leaves it under TIP_MIN cells there is none.
const CARD = '#34332f'
const TIP_CELLS = 48
const TIP_MIN = 20
// How tall a desktop row is, in CSS pixels, about: where an image's rows end.
const DESKTOP_ROW_PX = 19
const HEAD_CELLS = 24
// Refresh's width in the footer, about, so Compact now's card clears the
// headings too.
const REFRESH_CELLS = 12
// A card host's ground under the pointer.
const HOVER = { backgroundColor: '#ffffff10' }

// Card text: a line is a string or a list of pieces; a piece is a string
// (plain) or text with a style. The first line is bold; a later string line
// is dim.
type Style = 'b' | 'd' | 'f' | 'i' | 'good' | 'bad' | 'warn' | 'accent' | 'key' | 'tag' | 'tag-good' | 'tag-bad' | 'tag-warn'
type Piece = string | { t: string; s: Style }
type Line = string | Piece[]
// A card's kind, its bar down the left on the desktop and its rule's color in
// a terminal.
type Tone = 'action' | 'info' | 'warn' | 'danger' | 'good'
const FG = '#e9e7e2'
const DIM = '#9c9a94'
const FAINT = '#6f6d68'
const GOOD = '#7fc97f'
const BAD = '#ef8a80'
const WARN = '#e7c06b'
const ACCENT = '#8db4f0'
const CHIP = '#ffffff1f'
const TONES: Record<Tone, string> = { action: ACCENT, info: FAINT, warn: WARN, danger: BAD, good: GOOD }
const TINT: Partial<Record<Style, [string, string]>> = { 'tag-good': [GOOD, '#7fc97f26'], 'tag-bad': [BAD, '#ef8a8026'], 'tag-warn': [WARN, '#e7c06b26'], tag: [FG, CHIP], key: [FG, CHIP] }
const PIECE_COLORS: Partial<Record<Style, string>> = { d: DIM, f: FAINT, good: GOOD, bad: BAD, warn: WARN, accent: ACCENT }
// The fill level's card tone: good under 30%, warn to 70%, danger past it.
const LEVEL_TONES: Tone[] = ['good', 'warn', 'warn', 'danger']
const SEP: Piece = { t: ' · ', s: 'f' }
const dim = (t: string): Piece => ({ t, s: 'd' })
// A path: its folder dim, its file name bold.
const pathPieces = (path: string): Piece[] => {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? [{ t: path, s: 'b' }] : [dim(path.slice(0, i + 1)), { t: path.slice(i + 1), s: 'b' }]
}
// A headline: plain, its ` · ` faint.
const head = (text: string): Piece[] => text.split(' · ').flatMap((t, k) => (k === 0 ? [t] : [SEP, t]))
// A later line from a template: its words dim, its ${values} plain (a piece
// or pieces as they are, an empty one left out), its ` · ` faint.
const facts = (words: TemplateStringsArray, ...values: (string | number | Piece | Piece[])[]): Piece[] => {
  const out: Piece[] = []
  words.forEach((w, k) => {
    w.split(' · ').forEach((t, n) => {
      if (n > 0) out.push(SEP)
      if (t) out.push(dim(t))
    })
    const v = values[k]
    if (Array.isArray(v)) out.push(...v)
    else if (v !== undefined && v !== '') out.push(typeof v === 'number' ? String(v) : v)
  })
  return out
}
// A change against a baseline: good when it shrank, warn when it grew.
const change = (n: number): Piece => (n < 0 ? { t: signedExact(n), s: 'good' } : n > 0 ? { t: signedExact(n), s: 'warn' } : signedExact(n))

// One line of a card: its pieces as nested Text, so it stays one line. Props
// are left unset where they would be false: a heavy tree stalls the desktop.
function cardLine(Text: any, line: Line, i: number) {
  const head = i === 0
  if (typeof line === 'string')
    return (
      <Text key={`l${i}`} wrap="wrap" bold={head || undefined} color={head ? FG : PIECE_COLORS.d}>
        {line}
      </Text>
    )
  return (
    <Text key={`l${i}`} wrap="wrap" bold={head || undefined} color={FG}>
      {line.map((p, j) => {
        if (typeof p === 'string') return p
        const tint = TINT[p.s]
        if (tint) return <Text key={j} color={tint[0]} backgroundColor={tint[1]} bold={p.s === 'key' || undefined}>{` ${p.t} `}</Text>
        // In the bold headline, a dim or faint piece is not bold.
        return <Text key={j} bold={p.s === 'b' ? true : head && (p.s === 'd' || p.s === 'f') ? false : undefined} italic={p.s === 'i' || undefined} color={PIECE_COLORS[p.s]}>{p.t}</Text>
      })}
    </Text>
  )
}

// Who settled the window the breakdown measures against.
const WINDOW_SOURCE: Record<string, string> = { auto: 'model limit', env: 'env var', settings: 'settings', clientdata: 'account', experiment: 'experiment', 'model-default': 'model default', 'unknown-model': 'unknown model' }

const FOCUS_OPTIONS = [{ value: 'none', label: 'Keep everything' }, ...PRESETS.map(p => ({ value: p.key, label: p.label })), { value: 'custom', label: 'Custom focus…' }]

function contextPane($: EngineInterface, els: Els, r: Reading | null, folded: Record<string, boolean>, chosen: string, columns: number, cfg: Config, surface: string, level = 0) {
  const { Box, Text, Button } = els
  const Input = 'Input' in els ? els.Input : null
  const Select = 'Select' in els ? els.Select : null
  const Svg = 'Svg' in els ? els.Svg : null
  const onDesktop = Svg !== null
  const onTerminal = surface === 'terminal'
  // A pressable word, sitting where plain text would. Its box takes no key, so
  // the pointer on it is on the heading row and that row's card shows.
  const press = (key: string, label: string, onPress: () => void) => {
    const button = <Button key={key} plain label={label} onPress={onPress} />
    return onDesktop ? <Box marginX={-DESKTOP_BUTTON_PAD}>{button}</Box> : button
  }
  // The widest card that stays right of the fold headings.
  const clear = Math.min(TIP_CELLS, columns - HEAD_CELLS)
  // A hover card: the first line bold, a later string line dim, a line left
  // out when null; its tone a bar down its left on the desktop, its rule's
  // color in a terminal; none on a phone. By default it sits in its keyed
  // host and opens upward from it (a card hanging below is painted under the
  // rows after it).
  // With a `scope` it is one of `reveals` instead, shown while its host (which
  // names the scope) is hovered. One row clear of its host: a pointer leaving
  // the host crosses that row, so the card closes instead of holding the
  // pointer over what it covers.
  // From level 1 an info card is left out, from level 2 every card: its host
  // then draws as one with no card.
  const tip = (lines: (Line | null)[], tone: Tone = 'info', place: { left?: number; right?: number; top?: number; bottom?: number } = { right: 0, bottom: 1 }, width = clear, scope?: string) => {
    if (level >= 2 || (level >= 1 && tone === 'info')) return null
    const shown = lines.filter((l): l is Line => l !== null && l.length > 0)
    if (surface === 'mobile' || width < TIP_MIN || shown.length === 0) return null
    const body = shown.map((line, i) => cardLine(Text, line, i))
    return (
      <Box position="absolute" {...place} top={place.top === undefined ? undefined : place.top + 1} bottom={place.bottom === undefined ? undefined : place.bottom + 1} display="none" hover={scope ? { scope, display: 'flex' } : { display: 'flex' }} flexDirection={onTerminal ? 'column' : 'row'} backgroundColor={CARD} paddingX={onTerminal ? 0.75 : 0} paddingY={onTerminal ? 0 : 0.3} width={width} borderStyle={onTerminal ? 'round' : undefined} borderColor={onTerminal ? TONES[tone] : undefined}>
        {onTerminal
          ? body
          : [
              <Box key="bar" width={0.25} backgroundColor={TONES[tone]} />,
              <Box key="body" flexDirection="column" paddingX={0.75} flexShrink={1} minWidth={0}>
                {body}
              </Box>,
            ]}
      </Box>
    )
  }
  // The cards of the rows near the top, where an upward card is cut off: drawn
  // last in the pane, so they paint over every row, and opening downward from
  // `top`, the pane row under the host, at the right and about 60% of the pane
  // wide (never wider than `clear`), so the pointer going down the labels on
  // the left is not caught by an open card. Returns the host's hover.
  const reveals: any[] = []
  const below = Math.min(clear, TIP_CELLS, Math.max(HEAD_CELLS, Math.round(columns * 0.6)))
  const reveal: Reveal = (id, lines, top, tone = 'info') => {
    const scope = `tip:${id}`.slice(0, 64)
    const card = tip(lines, tone, { right: 0, top: Math.ceil(top) }, below, scope)
    if (card === null) return undefined
    reveals.push(card)
    return { scope, ...HOVER }
  }
  // A card host's hover: a faint ground, when it has a card.
  const lit = (card: unknown) => (card === null ? undefined : HOVER)
  const refresh = <Button key="refresh" label="Refresh" onPress={() => void readAll($, cfg, false)} />
  const b = r?.usage.breakdown
  if (r == null || b == null) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor>No reading yet.</Text>
        <Box flexDirection="row">{refresh}</Box>
      </Box>
    )
  }
  const ctx = r.usage
  const window = ctx.window ?? b.maxTokens
  const used = ctx.tokens ?? b.totalTokens
  const percent = Math.round(ctx.percent ?? b.percentage)
  const color = LEVEL_COLORS[fillLevel(percent)]!
  const compactAt = b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null
  const fmt = (n: number) => figure(n, window, cfg.numbers)

  // A bar: squares on the desktop, `scale` times their size, braille cells
  // elsewhere. `fit` leaves the width out so the image shrinks to the body.
  // The braille's box takes no key, so the pointer on it is on its row.
  const bar = (key: string, alt: string, segs: Segment[], total: number, blocks: number, share: number | null, scale: number, fit = false) =>
    Svg !== null ? (
      <Svg key={key} source={squaresSvg(segs, total, blocks, share, false, scale)} alt={alt} {...(fit ? {} : { width: barWidth(blocks) * scale, height: BAR_HEIGHT * scale })} />
    ) : (
      <Box flexDirection="row" flexShrink={0}>
        {brailleRuns(segs, total, blocks, share).map(run => (
          <Text color={run.color} bold={run.text === '|'}>{run.text}</Text>
        ))}
      </Box>
    )
  const mini = (key: string, alt: string, tokens: number, max: number, barColor: string) => bar(key, alt, [{ tokens, color: barColor }], max, MINI_BLOCKS, null, MINI_SCALE)
  // One row of the table, with its hover card, if any.
  const row = (key: string, label: any, value: string, miniBar: any = null, indent = INDENT, card: any = null) => (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center" paddingLeft={indent} hover={lit(card)}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {label}
      </Box>
      {miniBar}
      <Box width={VALUE_CELLS} flexShrink={0} justifyContent="flex-end">
        <Text color="subtle">{value}</Text>
      </Box>
      {card}
    </Box>
  )
  // A label on one line: the name whole beside a detail that truncates, or a
  // name alone that truncates (a path from its start).
  const label = (who: string, what = '', truncate: 'truncate-end' | 'truncate-start' = 'truncate-end', isIdle = false) =>
    what ? (
      <Box flexDirection="row" columnGap={1} minWidth={0}>
        <Box flexShrink={0}>
          <Text dimColor={isIdle}>{who}</Text>
        </Box>
        <Box flexShrink={1} minWidth={0}>
          <Text color="subtle" wrap="truncate-end">{what}</Text>
        </Box>
      </Box>
    ) : (
      <Text wrap={truncate} dimColor={isIdle}>{who}</Text>
    )
  // A section: its heading a fold arrow and title, a note beside it and a
  // figure in the value column, its card what pressing does and `info`; its
  // rows when open.
  // `isFitted`, at the top level, folds it whatever is stored, its note
  // saying so; a press still stores it open, for when the pane fits again.
  const section = (title: string, note: string, value: string, rows: () => any[], foldedByDefault = false, info: Line | null = null, isFitted = false) => {
    const isOpenStored = !(folded[title] ?? (cfg.sectionsFolded === 'all' || foldedByDefault))
    const isFolded = isFitted || !isOpenStored
    const toggle = () => void update($, folds, f => ({ ...f, [title]: isOpenStored }))
    const shownNote = isFitted ? 'folded to fit · hide other parts in the settings to open it' : note
    return (
      <Box key={`sec:${title}`} flexDirection="column" marginTop={1}>
        {row(
          `head:${title}`,
          <Box flexDirection="row" columnGap={1} alignItems="center">
            {press(`fold:${title}`, `${isFolded ? '▸' : '▾'} ${title}`, toggle)}
            {shownNote ? <Text color="subtle">{shownNote}</Text> : null}
          </Box>,
          value,
          null,
          0,
          tip([`${isFolded ? 'Unfolds' : 'Folds'} ${title}`, info], 'action'),
        )}
        {isFolded ? null : rows()}
      </Box>
    )
  }

  const parts: any[] = []
  const source = WINDOW_SOURCE[b.autocompactSource] ?? b.autocompactSource
  const headTip = reveal(
    'head',
    [
      head(`${exact(used)} of ${exact(window)} tokens · ${percentOf(used, window)}`),
      facts`${b.model} · breakdown window ${exact(b.rawMaxTokens)} (${source})`,
      compactAt === null ? 'Auto-compact off' : facts`Auto-compact at ${exact(compactAt)} · ${exact(Math.max(0, compactAt - used))} to go`,
      facts`${r.turns} turns · read at ${clockTime(r.readAt, true)}${dim(cfg.refresh === 'turn' ? ', again after each turn' : ', on Refresh')}`,
      facts`Yellow from ${'30%'} · orange from ${'50%'} · red from ${'70%'}`,
    ],
    1,
    LEVEL_TONES[fillLevel(percent)],
  )
  parts.push(
    <Box key="head" flexDirection="row" columnGap={1} alignItems="center" hover={headTip}>
      <Text bold color={color}>{percent}%</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color="subtle" wrap="truncate-end">of the window · {fmt(used)} of {fmt(window)}</Text>
      </Box>
      <Text color="subtle">{cfg.refresh === 'turn' ? 'each turn · ' : ''}{clockTime(r.readAt)}</Text>
    </Box>,
  )

  if (cfg.categories !== 'off') {
    // Fit: as many blocks as the body is wide (a desktop block is 9px at
    // its scale, a braille cell one column), else the configured count.
    const fitted = cfg.barWidth === Infinity
    const blocks = fitted ? Math.max(10, onDesktop ? Math.floor((columns * DESKTOP_CELL_PX + 2) / (9 * CATEGORY_SCALE)) : columns - 1) : cfg.barWidth
    parts.push(categories(els, Svg, (key, alt, segs, total, n, share) => bar(key, alt, segs, total, n, share, CATEGORY_SCALE, fitted && onDesktop), b, r.since, blocks, cfg, fmt, reveal))
  }

  // The fill after each turn: the line against where auto-compact fires,
  // the average growth in the value column, the last turn's beneath.
  if (cfg.history > 0) {
    const points = r.history.slice(-cfg.history)
    const g = growth(points)
    const average = cfg.historyGrowth && g.average !== null ? `+${short(Math.round(g.average))}/turn` : ''
    // The last drop in the run: a compaction.
    let drop = -1
    for (let i = 1; i < points.length; i++) if (points[i]! < points[i - 1]!) drop = i
    parts.push(
      section(
        'Fill per turn',
        points.length < 2 ? '' : `last ${points.length} turns`,
        average,
        () => {
          if (points.length < 2) return [row('history:wait', <Text color="subtle">Draws from the second turn on.</Text>, '')]
          const last = points[points.length - 1]!
          const chart =
            Svg !== null ? (
              <Svg key="spark" source={sparkSvg(points, compactAt, color, { compact: `auto-compact ${short(compactAt ?? 0)}`, last: short(last) })} alt={`fill over the last ${points.length} turns`} width={Math.max(240, (columns - INDENT) * DESKTOP_CELL_PX)} height={64} />
            ) : (
              <Text color={color}>{sparkText(points, Math.max(compactAt ?? 0, ...points))}</Text>
            )
          const chartTip = tip(
            [
              head(`Now ${exact(last)} · min ${exact(Math.min(...points))} · max ${exact(Math.max(...points))}`),
              compactAt === null ? 'Auto-compact off' : facts`Auto-compact at ${exact(compactAt)}, the dashed line · ${percentOf(last, compactAt)} of the way`,
              drop < 0 ? 'No compaction in these turns' : facts`Compacted ${points.length - 1 - drop} turns ago: ${exact(points[drop - 1]!)} → ${exact(points[drop]!)}`,
              facts`${points.length} turns drawn of ${r.history.length} kept, at most ${HISTORY_KEPT}`,
            ],
            'info',
            { right: 0, bottom: Svg !== null ? 3 : 1 },
          )
          const rows = [
            <Box key="history:chart" paddingLeft={INDENT} hover={lit(chartTip)}>
              {chart}
              {chartTip}
            </Box>,
          ]
          if (cfg.historyGrowth)
            rows.push(
              row('history:last', <Text color="subtle">{`last turn ${signed(g.last)} · now ${fmt(last)}`}</Text>, '', null, INDENT, tip([head(`Last turn ${signedExact(g.last)} · now ${exact(last)}`), g.average === null ? null : facts`${exact(g.average)}/turn on average since ${drop < 0 ? facts`${points.length} turns ago` : dim('the last compaction')}`])),
            )
          return rows
        },
        false,
        facts`The value: average growth a turn since the last compaction · the fill after each of the last ${HISTORY_KEPT} turns is kept`,
      ),
    )
  }

  const recent = cfg.forecast === 'recent' ? growth(r.history.slice(-6)).average : null
  const perTurn = recent ?? averageGrowth(used, r.turns)
  const forecastTip = tip([
    head(`${exact(used)} of ${exact(window)} tokens · ${b.model}`),
    compactAt === null ? 'Auto-compact off' : facts`Fires at ${exact(compactAt)} · ${exact(Math.max(0, compactAt - used))} to go`,
    cfg.forecast === 'off' || perTurn === null ? null : facts`${exact(perTurn)}/turn: ${recent !== null ? dim('the average of the last 6 turns') : facts`${exact(used)} over ${r.turns} turns`}`,
    facts`Window ${exact(b.rawMaxTokens)}, from the ${source}`,
  ])
  parts.push(
    <Box key="forecast" marginTop={1} hover={lit(forecastTip)}>
      <Text color="subtle">{compactSummary(compactAt, used, window, cfg.forecast === 'off' ? null : perTurn, fmt)}</Text>
      {forecastTip}
    </Box>,
  )

  if (cfg.cache !== 'off') {
    const u = b.apiUsage
    if (u === null) parts.push(section('Cache', 'last request', 'no request yet', () => [], false, 'No API response in this window yet'))
    else {
      // Each part's name on a card: read good, written a warning, fresh plain.
      const split = [
        { name: 'read', tokens: u.cache_read_input_tokens, color: 'success', means: 'Served from the prompt cache, billed at a tenth', named: { t: 'read', s: 'good' } as Piece },
        { name: 'written', tokens: u.cache_creation_input_tokens, color: 'warning', means: 'Written to the cache, billed above the base rate', named: { t: 'written', s: 'warn' } as Piece },
        { name: 'fresh', tokens: u.input_tokens, color: 'subtle', means: 'Neither read nor written: the base rate', named: 'fresh' as Piece },
      ]
      const total = split.reduce((n, s) => n + s.tokens, 0)
      const hit = total > 0 ? Math.round((split[0]!.tokens / total) * 100) : 0
      const io = facts`Of ${exact(total)} input tokens · ${exact(u.output_tokens)} output`
      const splitLine = (s: (typeof split)[number]) => facts`${exact(s.tokens)} ${s.named} · ${percentOf(s.tokens, total)}`
      parts.push(
        section(
          'Cache',
          'last request',
          `${hit}% read`,
          () =>
            cfg.cache === 'bar'
              ? split.map(s =>
                  row(
                    `cache:${s.name}`,
                    <Box flexDirection="row" columnGap={1}>
                      <Text color={s.color}>■</Text>
                      <Text>{s.name}</Text>
                    </Box>,
                    fmt(s.tokens),
                    mini(`cache-bar:${s.name}`, `${s.name} ${fmt(s.tokens)}`, s.tokens, total, s.color),
                    INDENT,
                    tip([splitLine(s), s.means, io]),
                  ),
                )
              : [row('cache:line', label(`${fmt(split[1]!.tokens)} written · ${fmt(split[2]!.tokens)} fresh`), fmt(split[0]!.tokens), null, INDENT, tip([...split.map(splitLine), io]))],
          false,
          facts`The value: the last request's input read from the cache · ${exact(u.output_tokens)} output tokens`,
        ),
      )
    }
  }

  // From level 4 the heaviest and by-tool lists keep FITTED_ROWS rows, their
  // notes saying so.
  const listMax = (n: number) => (level >= 4 ? Math.min(n, FITTED_ROWS) : n)
  if (cfg.heaviest > 0) {
    const all = r.heavy.filter(i => cfg.heaviestKind === 'all' || i.isTool).slice(0, cfg.heaviest)
    const items = all.slice(0, listMax(cfg.heaviest))
    const messages = b.categories.find(c => c.name === 'Messages')
    const messagesColor = messages?.color ?? 'merged'
    if (items.length > 0) {
      parts.push(
        section(
          'Heaviest in Messages',
          items.length < all.length ? `estimated · top ${items.length} to fit` : 'estimated',
          '',
          () =>
            items.map((i, n) =>
              row(
                `heavy:${n}`,
                label(i.who, i.what),
                fmt(i.tokens),
                mini(`heavy-bar:${n}`, `${i.who} ${fmt(i.tokens)}`, i.tokens, items[0]!.tokens, messagesColor),
                INDENT,
                tip([
                  head(`${exact(i.tokens)} tokens${messages ? ` · ${percentOf(i.tokens, messages.tokens)} of Messages` : ''}`),
                  i.isTool ? facts`A ${i.who} call: its input and result` : facts`${i.who === 'You' ? 'Your' : "Claude's"} message text`,
                  // A message's text is a quote; a call's input a plain value.
                  i.what ? [i.isTool ? i.what : { t: i.what, s: 'i' }] : null,
                  'Estimated here: about 4 characters a token',
                ]),
              ),
            ),
          false,
          facts`The ${items.length} largest items of the transcript, tool calls and messages, counted here`,
        ),
      )
    }
  }

  if (cfg.byTool > 0 && r.tools.length > 0) {
    const top = r.tools.slice(0, listMax(cfg.byTool))
    const isTrimmed = top.length < Math.min(cfg.byTool, r.tools.length)
    const allTools = r.tools.reduce((n, t) => n + t.tokens, 0)
    parts.push(
      section(
        'By tool',
        isTrimmed ? `results and inputs · top ${top.length} to fit` : 'results and inputs',
        '',
        () =>
          top.map(t => {
            const mcp = b.mcpTools.find(m => m.name === `mcp__${t.tool}`)
            return row(
              `tool:${t.tool}`,
              label(t.tool),
              `${fmt(t.tokens)}${cfg.byToolCalls ? ` · ${t.calls}` : ''}`,
              mini(`tool-bar:${t.tool}`, `${t.tool} ${fmt(t.tokens)}`, t.tokens, top[0]!.tokens, 'suggestion'),
              INDENT,
              tip([
                head(`${exact(t.tokens)} tokens · ${percentOf(t.tokens, allTools)} of all tool tokens`),
                facts`${t.calls} ${dim(t.calls === 1 ? 'call' : 'calls')} · ${exact(t.tokens / Math.max(1, t.calls))} a call`,
                // The full name: its server part dim, the tool's own name bold.
                mcp ? [dim(mcp.name.slice(0, mcp.name.lastIndexOf('__') + 2)), { t: mcp.name.slice(mcp.name.lastIndexOf('__') + 2), s: 'b' }] : null,
                mcp ? facts`On ${mcp.serverName} · its schema ${exact(mcp.tokens)}${mcp.isLoaded ? '' : dim(', deferred')}` : null,
              ]),
            )
          }),
        false,
        facts`${top.length} of ${r.tools.length} tools · each one's inputs and results summed, estimated${cfg.byToolCalls ? facts` · tokens · calls` : ''}`,
      ),
    )
  }

  // A drill row's card: a memory file's whole path, a server's tools loaded
  // and deferred, an agent's or skill's source.
  const itemTip = (s: Section, i: Section['items'][number]) => {
    const shareOf = s.tokens > 0 && i.tokens > 0 ? percentOf(i.tokens, s.tokens) : null
    const share = shareOf === null ? [] : facts` · ${shareOf} of the section`
    if (s.title === 'Memory files') return tip([pathPieces(i.name), facts`${i.note ?? ''} · ${exact(i.tokens)} tokens${share}`])
    if (s.title === 'MCP tools') {
      const tools = b.mcpTools.filter(t => t.serverName === i.name)
      const names = (list: typeof tools, withTokens: boolean): Piece[] =>
        list
          .slice(0, 6)
          .flatMap((t, k) => [...(k > 0 ? [SEP] : []), `${t.name.split('__').pop()}${withTokens ? ` ${short(t.tokens)}` : ''}`])
          .concat(list.length > 6 ? [SEP, `+${list.length - 6}`] : [])
      const loaded = tools.filter(t => t.isLoaded)
      const deferred = tools.filter(t => !t.isLoaded)
      return tip([
        head(`${i.name} · ${exact(i.tokens)} tokens${shareOf === null ? '' : ` · ${shareOf} of the section`}`),
        loaded.length ? facts`Loaded: ${names(loaded, true)}` : null,
        deferred.length ? facts`Deferred, 0 until searched: ${names(deferred, false)}` : null,
      ])
    }
    if (s.title === 'Skills') return tip([i.name, facts`${i.plugin ? facts`From ${i.plugin} · ` : ''}${i.note ?? ''}`, i.listed ? facts`${exact(i.listed)} tokens in the listing` : null])
    return tip([i.name, facts`${exact(i.tokens)} tokens${share} · from ${i.note ?? ''}`])
  }
  // From level 3 an open section lists fewer items, the "+N more" row saying
  // they were trimmed to fit; at the top level every one is folded.
  const drill = sections(b)
  const itemsMax = level >= 4 ? Math.min(cfg.sectionsMax, FITTED_ITEMS[1]!) : level >= 3 ? Math.min(cfg.sectionsMax, FITTED_ITEMS[0]!) : cfg.sectionsMax
  const isTrimmed = itemsMax < cfg.sectionsMax
  for (const s of drill) {
    const isPath = s.title === 'Memory files'
    // Agents and skills can share a name across plugins: a repeat's key
    // takes its count, so every row keeps a key of its own.
    const seen = new Map<string, number>()
    const keyOf = (name: string) => {
      const k = seen.get(name) ?? 0
      seen.set(name, k + 1)
      return k === 0 ? `${s.title}:${name}` : `${s.title}:${name}#${k}`
    }
    const info =
      s.title === 'Memory files'
        ? facts`${exact(s.tokens)} tokens in ${s.items.length} files`
        : s.title === 'MCP tools'
          ? facts`${exact(s.tokens)} tokens of loaded schemas over ${s.items.length} servers · a deferred tool counts 0`
          : s.title === 'Skills' && b.skills
            ? facts`${exact(s.tokens)} tokens in the listing · ${b.skills.includedSkills} of ${b.skills.totalSkills} skills listed`
            : facts`${exact(s.tokens)} tokens of descriptions · ${s.items.length} agents`
    parts.push(
      section(
        s.title,
        '',
        `${fmt(s.tokens)} · ${s.items.length}`,
        () => {
          const shown = s.items.slice(0, itemsMax)
          const rows = shown.map(i => row(keyOf(i.name), label(isPath ? shortPath(i.name, cfg.paths) : i.name, '', isPath ? 'truncate-start' : 'truncate-end', i.isIdle), `${i.tokens > 0 ? `${fmt(i.tokens)} · ` : ''}${i.note ?? ''}`, null, INDENT, itemTip(s, i)))
          const hidden = s.items.slice(shown.length)
          if (hidden.length > 0)
            rows.push(
              row(
                keyOf('more'),
                <Text color="subtle" wrap="truncate-end">{isTrimmed ? `+${hidden.length} more · trimmed to fit, fold other sections to list them` : `+${hidden.length} more`}</Text>,
                '',
                null,
                INDENT,
                tip([`${hidden.length} more, past the ${itemsMax} shown`, ...hidden.slice(0, 4).map(i => facts`${isPath ? basename(i.name) : i.name} · ${exact(i.tokens)}`), hidden.length > 4 ? `+${hidden.length - 4} more` : null]),
              ),
            )
          return rows
        },
        cfg.sectionsFolded === 'mcp' && s.title === 'MCP tools',
        info,
        level >= TOP_LEVEL,
      ),
    )
  }

  if (r.startup) {
    const st = r.startup
    const startupTip = tip([
      'Every category in use but Messages, at the first read',
      st.average === null ? facts`${exact(st.tokens)} tokens · no earlier session to compare` : facts`${exact(st.tokens)} now vs ${exact(st.average)} on average · ${change(st.tokens - st.average)}`,
      facts`${st.sessions} earlier ${dim(st.sessions === 1 ? 'session' : 'sessions')} ${dim(cfg.baseline === 'all' ? 'across projects' : 'in this project')} · the last ${STARTUPS_KEPT} are kept`,
    ])
    parts.push(
      <Box key="startup" marginTop={1} hover={lit(startupTip)}>
        <Text color="subtle">{startupLine(st, cfg.baseline, fmt)}</Text>
        {startupTip}
      </Box>,
    )
  }

  // The footer: the focus a compaction keeps, Compact now, Refresh. A custom
  // focus is typed in place of the picker; submitted empty, the picker
  // comes back.
  // Their cards open upward; the focus's starts past the fold headings, and
  // Compact now's and Refresh's end at their buttons, on the right.
  const setFocus = (value: string) => void update($, focus, () => value)
  const actions: any[] = []
  const preset = PRESETS.find(p => p.key === chosen)
  const compactWith = () => compactNow($, preset?.instructions ?? '')
  const focusAt = { left: HEAD_CELLS, bottom: 1 }
  if (cfg.compactActions === 'presets' && chosen === 'custom' && Input !== null) {
    // Submitting compacts, as Compact now does: a warning.
    const focusTip = tip(['Closes this pane and runs /compact with what you type', 'Submitted empty, the presets come back'], 'warn', focusAt)
    actions.push(
      <Box key="focus-box" flexGrow={1} flexShrink={1} minWidth={0} hover={lit(focusTip)}>
        <Input key="focus" placeholder="What the summary should keep" submitLabel="Compact" autoFocus onSubmit={(text: string) => (text.trim() ? void compactNow($, text.trim()) : setFocus('none'))} />
        {focusTip}
      </Box>,
    )
  } else {
    const isPicking = cfg.compactActions === 'presets' && Select !== null
    const focusTip = isPicking ? tip(['Picks what Compact now asks the summary to keep', preset ? [{ t: `"${preset.instructions}"`, s: 'i' }] : 'Keep everything: /compact with no instructions', 'Custom focus… types your own'], 'action', focusAt) : null
    actions.push(
      <Box key="focus-box" flexGrow={1} flexShrink={1} minWidth={0} hover={lit(focusTip)}>
        {isPicking ? <Select key="focus" options={FOCUS_OPTIONS} value={chosen} onSelect={(value: string) => setFocus(value)} /> : null}
        {focusTip}
      </Box>,
      <Box key="tip:compact" flexShrink={0}>
        <Button key="compact" label="Compact now" onPress={() => void compactWith()} />
        {tip(
          ['Closes this pane and runs /compact', preset ? facts`Focus: ${preset.label}, picked at left` : 'No focus: the summary keeps everything', "Where /compact can't run from here, a toast says what to type"],
          // It changes the conversation: a warning.
          'warn',
          // Out past Refresh to the pane's edge, so it is as wide as the others.
          { right: -REFRESH_CELLS, bottom: 1 },
          clear,
        )}
      </Box>,
    )
  }
  actions.push(
    <Box key="tip:refresh" flexShrink={0}>
      {refresh}
      {tip(['Reads the breakdown, the turns and the transcript again', facts`Last read at ${clockTime(r.readAt, true)}${cfg.refresh === 'turn' ? facts` · also after each turn while shown` : ''}`], 'action')}
    </Box>,
  )
  parts.push(
    <Box key="footer" flexDirection="row" columnGap={1} alignItems="center" marginTop={1}>
      {actions}
    </Box>,
  )

  return (
    <Box flexDirection="column">
      {parts}
      {reveals}
    </Box>
  )
}

// The categories: a stacked bar with a two-column legend, a list, or
// /context's grid; each with its growth since the baseline. Their cards are
// `reveal`s, opening downward: the bar sits in the pane's top rows.
function categories(els: Els, Svg: any, bar: (key: string, alt: string, segs: Segment[], total: number, blocks: number, share: number | null) => unknown, b: SessionContextBreakdown, base: Record<string, number> | null, blocks: number, cfg: Config, fmt: (n: number) => string, reveal: Reveal) {
  const { Box, Text } = els
  const window = b.maxTokens
  let rows = b.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
  if (cfg.categories !== 'list') rows = rows.filter(c => c.kind === 'used')
  if (cfg.categoryOrder === 'size') rows = [...rows].sort(byTokens)
  const isSmall = (n: number) => window > 0 && (n / window) * 100 < cfg.categoryHide
  const small = rows.filter(c => c.kind === 'used' && isSmall(c.tokens))
  const shown = rows.filter(c => !small.includes(c))
  const delta = (name: string, tokens: number) => {
    if (base === null) return null
    const d = tokens - (base[name] ?? 0)
    return Math.abs(d) < 100 ? null : <Text color={d > 0 ? 'warning' : 'subtle'}>{signed(d)}</Text>
  }
  const share = (n: number) => (window > 0 ? `${Math.round((n / window) * 100)}%` : '')
  const compactShare = b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined && window > 0 ? b.autoCompactThreshold / window : null

  // The pane rows: the header, a gap, then the bar (an image's in desktop
  // rows), the legend, the small line.
  const squares = b.gridRows.reduce((n, r) => n + r.length, 0)
  const barRows = cfg.categories === 'stacked' ? (Svg !== null ? (BAR_HEIGHT * CATEGORY_SCALE) / DESKTOP_ROW_PX : 1) : cfg.categories === 'grid' ? (Svg !== null ? (b.gridRows.length * 9 - 2) / DESKTOP_ROW_PX : b.gridRows.length) : 0
  const legendTop = 2 + barRows
  const usedTokens = b.categories.filter(c => c.kind === 'used').reduce((n, c) => n + c.tokens, 0)
  const kindTokens = (kind: string) => b.categories.filter(c => c.kind === kind).reduce((n, c) => n + c.tokens, 0)
  const sinceWord = cfg.since === 'open' ? 'when the pane opened' : 'after the last compaction'

  const out: any[] = []
  const barTip =
    cfg.categories === 'stacked' || cfg.categories === 'grid'
      ? reveal(
          'bar',
          [
            head(`${exact(usedTokens)} used of ${exact(window)} · ${exact(kindTokens('free'))} free`),
            kindTokens('buffer') > 0 ? facts`${exact(kindTokens('buffer'))} kept free for auto-compact` : null,
            compactShare === null ? 'Auto-compact off' : facts`${dim(cfg.categories === 'stacked' ? 'The tick: a' : 'A')}uto-compact at ${exact(b.autoCompactThreshold ?? 0)} (${percentOf(b.autoCompactThreshold ?? 0, window)})`,
            cfg.categories === 'stacked' ? facts`A block is ${exact(window / Math.max(1, blocks))} tokens, a square a tenth` : facts`A square is ${exact(window / Math.max(1, squares))} tokens`,
            kindTokens('deferred') > 0 ? facts`${exact(kindTokens('deferred'))} in tool schemas loaded on demand, outside it` : null,
          ],
          legendTop,
        )
      : undefined
  if (cfg.categories === 'stacked') {
    out.push(
      <Box key="bar" flexDirection="column" hover={barTip}>
        {bar('stacked', 'categories', rows.map(c => ({ tokens: c.tokens, color: c.color })), window, blocks, compactShare)}
      </Box>,
    )
  } else if (cfg.categories === 'grid') {
    out.push(
      <Box key="bar" flexDirection="column" hover={barTip}>
        {Svg !== null ? (
          <Svg key="grid" source={gridSvg(b.gridRows)} alt="context grid" />
        ) : (
          <Box key="grid" flexDirection="column">
            {b.gridRows.map((row, i) => (
              <Box key={`grid:${i}`} flexDirection="row">
                {row.map(sq => (sq.isFilled ? <Text color={sq.color}>■ </Text> : <Text color="subtle">□ </Text>))}
              </Box>
            ))}
          </Box>
        )}
      </Box>,
    )
  }
  const isLegend = cfg.categories !== 'list'
  // A category's card: its exact tokens and shares, and the baseline it grew
  // from, the change under 100 the legend leaves out included.
  const catTip = (c: (typeof shown)[number], i: number) => {
    const b0 = base?.[c.name] ?? 0
    return reveal(
      `cat:${c.name}`,
      [
        head(`${c.name} · ${exact(c.tokens)} tokens`),
        facts`${percentOf(c.tokens, window)} of the window${c.kind === 'used' ? facts` · ${percentOf(c.tokens, usedTokens)} of what is used` : ''}`,
        c.kind === 'free' ? 'The window left before it fills' : c.kind === 'buffer' ? 'Kept free so auto-compact can run' : null,
        c.kind === 'used' && base !== null ? facts`${exact(b0)} ${dim(sinceWord)} · ${change(c.tokens - b0)}` : null,
      ],
      legendTop + (isLegend ? Math.floor(i / 2) : i) + 1,
    )
  }
  out.push(
    <Box key="legend" flexDirection={isLegend ? 'row' : 'column'} flexWrap={isLegend ? 'wrap' : 'nowrap'}>
      {shown.map((c, i) => (
        <Box key={`cat:${c.name}`} flexDirection="row" columnGap={1} width={isLegend ? '50%' : undefined} paddingRight={isLegend ? 2 : 0} hover={catTip(c, i)}>
          <Text color={c.color}>{c.kind === 'used' ? '■' : '□'}</Text>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{c.name}</Text>
          </Box>
          {c.kind === 'used' ? delta(c.name, c.tokens) : null}
          <Text color="subtle">{fmt(c.tokens)}{isLegend ? '' : ` · ${share(c.tokens)}`}</Text>
        </Box>
      ))}
    </Box>,
  )
  if (small.length > 0) {
    const smallTip = reveal(
      'small',
      [`${small.length} under ${cfg.categoryHide}% of the window`, ...small.slice(0, 4).map(c => facts`${c.name} · ${exact(c.tokens)} · ${percentOf(c.tokens, window)}`), small.length > 4 ? `+${small.length - 4} more` : null],
      legendTop + (isLegend ? Math.ceil(shown.length / 2) : shown.length) + 1,
    )
    out.push(
      <Box key="small" hover={smallTip}>
        <Text color="subtle">{`+${small.length} under ${cfg.categoryHide}% · ${fmt(small.reduce((n, c) => n + c.tokens, 0))}`}</Text>
      </Box>,
    )
  }
  return <Box key="categories" flexDirection="column" marginTop={1}>{out}</Box>
}

// Growth per turn over a run of fills: the average over the stretch since
// the last drop (a compaction), and the last turn's.
export function growth(points: number[]): { average: number | null; last: number } {
  let from = 0
  for (let i = 1; i < points.length; i++) if (points[i]! < points[i - 1]!) from = i
  const run = points.slice(from)
  const last = points.length >= 2 ? points[points.length - 1]! - points[points.length - 2]! : 0
  return { average: run.length >= 2 ? (run[run.length - 1]! - run[0]!) / (run.length - 1) : null, last }
}

const averageGrowth = (used: number, turns: number) => (turns > 0 && used > 0 ? used / turns : null)

// Where auto-compact fires and about how many turns are left before it does,
// at `perTurn` tokens a turn (none, no forecast).
export function compactSummary(compactAt: number | null, used: number, window: number, perTurn: number | null, fmt: (n: number) => string = short) {
  if (compactAt === null) return 'Auto-compact off'
  const at = window > 0 ? ` (${Math.round((compactAt / window) * 100)}%)` : ''
  const left = perTurn !== null && perTurn > 0 ? Math.max(0, Math.round((compactAt - used) / perTurn)) : null
  return `Auto-compact at ${fmt(compactAt)}${at}${left === null ? '' : ` · about ${left} turns before it fires`}`
}

export function startupLine(s: Startup, scope: Config['baseline'], fmt: (n: number) => string) {
  const where = scope === 'all' ? 'across projects' : 'in this project'
  if (s.average === null) return `Startup ${fmt(s.tokens)} · the first session kept ${where}`
  const diff = Math.round(((s.tokens - s.average) / s.average) * 100)
  return `Startup ${fmt(s.tokens)} · your average ${fmt(Math.round(s.average))} over ${s.sessions} ${s.sessions === 1 ? 'session' : 'sessions'} ${where}${diff === 0 ? '' : ` · ${diff > 0 ? '+' : ''}${diff}%`}`
}

// A skill's item keeps its plugin and its own tokens in the listing, for its
// card.
type Section = { title: string; tokens: number; items: { name: string; tokens: number; note?: string; isIdle?: boolean; plugin?: string; listed?: number }[] }

// What stands behind the categories, largest first; an empty one is left out.
// An MCP server counts its loaded tools' schemas alone: a deferred tool is in
// the window only once loaded. One with none loaded is idle.
export function sections(b: Pick<SessionContextBreakdown, 'memoryFiles' | 'mcpTools' | 'agents' | 'skills'>): Section[] {
  const servers = new Map<string, { tokens: number; tools: number; loaded: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { tokens: 0, tools: 0, loaded: 0 }
    servers.set(t.serverName, { tokens: s.tokens + (t.isLoaded ? t.tokens : 0), tools: s.tools + 1, loaded: s.loaded + (t.isLoaded ? 1 : 0) })
  }
  const all: Section[] = [
    section('Memory files', b.memoryFiles.map(f => ({ name: f.path, tokens: f.tokens, note: f.type }))),
    section('MCP tools', [...servers].map(([name, s]) => ({ name, tokens: s.tokens, note: `${s.loaded}/${s.tools} loaded`, ...(s.loaded === 0 ? { isIdle: true } : {}) }))),
    section('Agents', b.agents.map(a => ({ name: a.agentType, tokens: a.tokens, note: a.source }))),
    section('Skills', (b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, tokens: 0, note: s.source, listed: s.tokens, ...(s.pluginName ? { plugin: s.pluginName } : {}) })), b.skills?.tokens),
  ]
  return all.filter(s => s.items.length > 0)
}

function section(title: string, items: Section['items'], tokens?: number): Section {
  const sorted = [...items].sort(byTokens)
  return { title, tokens: tokens ?? sorted.reduce((n, i) => n + i.tokens, 0), items: sorted }
}

// A memory file's path in full, from the home folder, or its name alone.
export function shortPath(path: string, style: Config['paths']) {
  if (style === 'name') return basename(path)
  if (style === 'home') return path.replace(/^([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/]+/, '~')
  return path
}

// A figure as 12.3k, 12,345 or its share of the window.
export function figure(n: number, window: number, style: Config['numbers']) {
  if (style === 'comma') return Math.round(n).toLocaleString('en-US')
  if (style === 'percent') return window > 0 ? `${+((n / window) * 100).toFixed(1)}%` : short(n)
  return short(n)
}

const signed = (n: number) => `${n < 0 ? '−' : '+'}${short(Math.abs(Math.round(n)))}`
// A figure whole, with commas, for the hover cards.
const exact = (n: number) => Math.round(n).toLocaleString('en-US')
const signedExact = (n: number) => `${n < 0 ? '−' : '+'}${exact(Math.abs(n))}`
const percentOf = (n: number, of: number) => (of > 0 ? `${+((n / of) * 100).toFixed(1)}%` : '')

function clockTime(ms: number, seconds = false) {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? `:${two(d.getSeconds())}` : ''}`
}

// 1234 -> 1.2k, 1_000_000 -> 1M.
export function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
