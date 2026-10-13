// The Usage pane: each limit as one line and one verdict, motta-statusline's
// bar between its name and its percent; the rest, side by side for 5h and
// 7d, under `details`, a row only where it has something to say. Spacing
// comes from the layout's gaps, never from spaces between pieces: a desktop
// draws a proportional font, where a space has no fixed width.

import type { RenderSurface } from 'claude-code'

import type { Kept, Limit, Settings } from './figures.ts'
import {
  burnRate,
  elapsedShare,
  hourlyBudget,
  isSameWindow,
  limitLevel,
  pointsOf,
  resetIn,
  runwayMs,
  sessionTurns,
  sparkDots,
} from './figures.ts'
import { activityFigures, crossSvg, dateOfKey, dayText, daysAcross, grid, gridSvg, gridText, modelsText, SLOT_HOURS, WEEKDAYS, weekdaySums } from './activity.tsx'
import type { Days, ModelDays } from './figures.ts'
import { MODEL_FAMILIES, MODEL_NAMES } from './figures.ts'
import { blockDots, blocksWidth, dotsAcross, meter, type Ramp, seriesBlocks, SQ_H, squaresSvg, svgColor, wideBarSvg, wideBarWidth } from './meter.tsx'

export type View = {
  limits: Limit[] | null
  kept: Record<string, Kept>
  days: Days
  models: ModelDays
  // Cells across the pane's body.
  columns: number
  session: { id: string | null; startedAt: number | null; costUsd: number | null }
  settings: Settings
  showDetails: boolean
  onToggleDetails: () => void
  now: number
  // Where it is drawn: a phone has no pointer, so no hover cards.
  surface: RenderSurface
}

const DAY = 86_400_000

// Cells the details table gives its labels; the limits share the rest.
const LABEL_W = 14
// A desktop cell in pixels, as savvy-progress sizes its cards, and a row,
// as measured: how far a card rises over an image.
const CELL_PX = 8
const ROW_PX = 19

// The hover cards, as changes-drill draws its own: the card's background.
const CARD = '#34332f'

// Card text: a line is a string or a list of pieces; a piece is a string
// (plain) or text with a style. The first line is bold; a later plain-string
// line is dim.
type Style = 'b' | 'd' | 'f' | 'i' | 'good' | 'bad' | 'warn' | 'accent' | 'key' | 'tag' | 'tag-good' | 'tag-bad' | 'tag-warn'
type Piece = string | { t: string; s: Style }
type Line = string | Piece[]
type Tone = 'action' | 'info' | 'warn' | 'danger' | 'good'
const FG = '#e9e7e2', DIM = '#9c9a94', FAINT = '#6f6d68', GOOD = '#7fc97f', BAD = '#ef8a80', WARN = '#e7c06b', ACCENT = '#8db4f0', CHIP = '#ffffff1f'
const TONES: Record<Tone, string> = { action: ACCENT, info: FAINT, warn: WARN, danger: BAD, good: GOOD }
const TINT: Record<string, [string, string]> = { 'tag-good': [GOOD, '#7fc97f26'], 'tag-bad': [BAD, '#ef8a8026'], 'tag-warn': [WARN, '#e7c06b26'], tag: [FG, CHIP], key: [FG, CHIP] }
// A faint separator piece, a dim label piece, a hotkey chip.
const SEP = { t: ' · ', s: 'f' } as const
const soft = (t: string): Piece => ({ t, s: 'd' })
const kbd = (t: string): Piece => ({ t, s: 'key' })
// Groups of pieces with a faint separator between them.
const joined = (groups: Piece[][]): Piece[] => groups.flatMap((g, i) => (i === 0 ? g : [SEP, ...g]))
// A line's width in cells: a chip adds a space at each side.
const lineLength = (line: Line) => (typeof line === 'string' ? line.length : line.reduce((n, p) => n + (typeof p === 'string' ? p.length : p.t.length + (TINT[p.s] ? 2 : 0)), 0))

// One line of a card: its pieces as nested Text, so it stays one line.
function cardLine(Text: any, line: Line, i: number, wrap: string) {
  const pieces: Piece[] = typeof line === 'string' ? [{ t: line, s: i === 0 ? 'b' : 'd' }] : line
  return (
    <Text key={`l${i}`} wrap={wrap} bold={i === 0} color={FG}>
      {pieces.map((p, j) => {
        if (typeof p === 'string') return p
        const tint = TINT[p.s]
        if (tint) return <Text key={j} color={tint[0]} backgroundColor={tint[1]} bold={p.s === 'key'}>{` ${p.t} `}</Text>
        return <Text key={j} bold={p.s === 'b'} italic={p.s === 'i'} color={p.s === 'd' ? DIM : p.s === 'f' ? FAINT : p.s === 'good' ? GOOD : p.s === 'bad' ? BAD : p.s === 'warn' ? WARN : p.s === 'accent' ? ACCENT : undefined}>{p.t}</Text>
      })}
    </Text>
  )
}

// A verdict's card takes the verdict's own status.
const verdictTone = (color: string): Tone => (color === 'success' ? 'good' : color === 'error' ? 'danger' : color === 'warning' || color === '#ff8700' ? 'warn' : 'info')
// The rule behind a verdict's color, its color word in that color.
function whyLine(why: string): Line {
  const m = /^(red|orange|yellow|green): (.*)$/.exec(why)
  if (m === null) return why
  const [, word = '', rest = ''] = m
  return [{ t: word, s: word === 'green' ? 'good' : word === 'red' ? 'bad' : 'warn' }, soft(`: ${rest}`)]
}

// What a limit comes to, in a few words and a color: `lead` in the color,
// `tail` after it, subtle; `why` the rule behind the color.
export type Verdict = { color: string; lead: string; tail: string; why: string }

export function verdictOf(l: Limit, pace: number | null, burn: number | null, now: number, s: Settings): Verdict | null {
  if (l.resetsAt === null || l.windowMs === null || pace === null) return null
  if (pace < 0.02) return { color: 'subtle', lead: 'Too early to tell', tail: '', why: 'a verdict from 2% of the window on' }
  if (l.exact <= 0) return { color: 'success', lead: 'Nothing used yet', tail: '', why: '' }
  const msLeft = Math.max(0, l.resetsAt - now)
  const average = l.exact / ((pace * l.windowMs) / 3_600_000)
  const left = runwayMs(l.exact, s.runwayBasis === 'recent' ? burn : average)
  if (s.runway && left !== null && left < msLeft) {
    return { color: 'error', lead: `Runs out at ${clockAt(now + left, left > DAY, s)}`, tail: `${resetIn(msLeft - left)} before the reset`, why: 'red: full before the reset' }
  }
  const end = `about ${Math.min(100, Math.round(l.exact / pace))}% by the reset`
  const color = limitLevel(l.percent, pace, s)
  if (color === 'error') return { color, lead: 'Near the limit', tail: end, why: `red: at ${s.redFrom}% or more` }
  if (color === '#ff8700') return { color, lead: 'Ahead of pace', tail: end, why: `orange: ${s.paceMargin} pts or more ahead of the window's time` }
  if (l.exact / pace >= s.redFrom) return { color: 'warning', lead: 'Tight', tail: end, why: `yellow: heading for ${s.redFrom}% or more by the reset` }
  return { color: 'success', lead: 'On track', tail: end, why: `green: heading for under ${s.redFrom}% by the reset` }
}

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The pane draws at
// the richest level that fits: 0 every card, 1 action and status cards only,
// 2 no cards. Its layout is fixed in size, so it has no folds of its own.
export const BUDGET = 1000
// Characters of the serialized tree, an inline SVG's source included.
export const CHAR_BUDGET = 200_000
// The level with no cards: the terminal's (see fit).
export const NO_CARDS = 2
export const TOP_LEVEL = 2
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
// Draws at level 0, then 1, 2, ... until the tree fits `budget` or `top` is
// reached. Only the desktop (and VS Code) has the limit. The terminal draws
// no hover cards at all, its folds left out: level NO_CARDS.
export function fit<T>(surface: string, top: number, draw: (level: number) => T, budget = BUDGET): T {
  if (surface === 'terminal') return draw(NO_CARDS)
  if (surface !== 'desktop' && surface !== 'vscode') return draw(0)
  let tree = draw(0)
  for (let level = 1; level <= top && (countNodes(tree) > budget || JSON.stringify(tree).length > CHAR_BUDGET); level += 1) tree = draw(level)
  return tree
}
// Whether a card of `tone` is drawn at `level`: level 1 keeps action and
// status cards, level 2 none.
const cardAt = (level: number, tone: Tone) => level <= 0 || (level === 1 && tone !== 'info')

export function usagePane(table: any, Svg: any, v: View, level = 0) {
  const { Box, Text, Button } = table
  const s = v.settings
  if (v.limits === null || v.limits.length === 0) return <Text dimColor>No rate-limit reading yet: one comes with the next response.</Text>
  const compact = s.density === 'compact'
  const columns = Math.max(40, v.columns || 80)
  // The body's width in pixels on the desktop.
  const widthPx = Math.max(240, columns * CELL_PX - CELL_PX)
  const VALUE_W = Math.max(16, Math.floor((columns - LABEL_W) / Math.max(1, v.limits.length)) - 1)
  // A card's host: a faint highlight under the pointer, and the scope a card
  // drawn elsewhere is revealed by. A phone has no pointer, and no cards.
  type Hover = { scope?: string; backgroundColor?: string }
  const LIT: Hover | undefined = v.surface === 'mobile' ? undefined : { backgroundColor: '#ffffff10' }
  // A host's highlight: only when it has a card.
  const lit = (card: unknown) => (card === null ? undefined : LIT)
  // A card that opens downward: narrower, at the pane's right, so the pointer
  // going down the labels on the left leaves it.
  const DOWN_W = Math.min(48, Math.max(24, Math.round(columns * 0.6)))

  // Pieces in a row that wraps between them; a piece left out is false. A
  // row with no key is no hover scope, so a cell's card shows over all of it.
  const row = (key: string | null, parts: unknown[], gap = compact ? 1 : 2, hover?: Hover) => (
    <Box key={key ?? undefined} flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={gap} hover={hover}>
      {parts.filter(p => p !== false && p !== null && p !== undefined)}
    </Box>
  )
  const term = v.surface === 'terminal'
  type Lines = (Line | false | null | undefined)[]
  type Place = { bottom?: number; top?: number; side?: 'left' | 'right'; scope?: string }
  const shownOf = (lines: Lines) => lines.filter((t): t is Line => (typeof t === 'string' && t !== '') || (Array.isArray(t) && t.length > 0)).slice(0, 6)
  // A hover card: by default rising `bottom` cells from its host's foot (a
  // row drawn later paints over a card hanging below), at the host's right;
  // none on a phone, which has no pointer. One row clear of its host: a pointer
  // leaving the host crosses that row, so the card closes instead of holding
  // the pointer over what it covers. Its tone is a bar down its left edge on
  // the desktop, its border's color in the terminal.
  const tip = (lines: Lines, at: Place = {}, tone: Tone = 'info') => {
    const shown = shownOf(lines)
    if (v.surface === 'mobile' || shown.length === 0 || !cardAt(level, tone)) return null
    const down = at.top !== undefined
    const side = down ? 'right' : (at.side ?? 'right')
    const drawn = shown.map((t, i) => cardLine(Text, t, i, 'wrap'))
    return (
      <Box
        position="absolute"
        top={at.top === undefined ? undefined : at.top + 1}
        bottom={at.top === undefined ? (at.bottom ?? 1) + 1 : undefined}
        left={side === 'left' ? 0 : undefined}
        right={side === 'right' ? 0 : undefined}
        display="none"
        hover={at.scope === undefined ? { display: 'flex' } : { scope: at.scope, display: 'flex' }}
        flexDirection={term ? 'column' : 'row'}
        backgroundColor={CARD}
        paddingX={term ? 0.75 : 0}
        paddingY={term ? 0 : 0.3}
        width={down ? DOWN_W : Math.min(48, columns - 2)}
        borderStyle={term ? 'round' : undefined}
        borderColor={term ? TONES[tone] : undefined}
      >
        {term
          ? drawn
          : [
              <Box key="bar" width={0.25} backgroundColor={TONES[tone]} />,
              <Box key="text" flexDirection="column" paddingX={0.75} flexShrink={1} minWidth={0}>
                {drawn}
              </Box>,
            ]}
      </Box>
    )
  }
  // Cards of rows too near the pane's top to rise over the rows above: drawn
  // last, below their row, so they paint over the rows under it, and shown
  // while their row, their scope, is hovered.
  const reveals: unknown[] = []
  // The pane line the lowest revealed card reaches, by its wrapped lines.
  let reach = 0
  // The card of a row on line `at` of the pane (0 its top): over the lines
  // above when they hold it, else revealed below, 4 lines at most; the row
  // takes `hover`.
  const tipAt = (id: string, at: number, lines: Lines, tone: Tone = 'info'): { card: unknown; hover?: Hover } => {
    const shown = shownOf(lines)
    if (at - (term ? 2 : 1) >= shown.length) {
      const card = tip(shown, {}, tone)
      return { card, hover: card === null ? undefined : LIT }
    }
    const scope = `tip:${id}`
    const below = shown.slice(0, 4)
    const card = tip(below, { top: at + 1, scope }, tone)
    if (card === null) return { card: null }
    reveals.push(card)
    reach = Math.max(reach, at + 1 + (term ? 2 : 1) + below.reduce((n, t) => n + Math.ceil(lineLength(t) / Math.max(1, DOWN_W - 3)), 0))
    return { card: null, hover: { ...LIT, scope } }
  }
  const fullAt = (at: number) => `${dayText(at)}, ${clockAt(at, false, s)}`
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  // A 0-10 lit block per entry: squares on the desktop, braille elsewhere,
  // a tick at `share` (0-1) of the bar.
  const bar = (alt: string, lit: number[], color: string | string[], share: number | null, ramp: Ramp) =>
    Svg !== null ? (
      <Svg source={squaresSvg(lit, color, share, ramp)} alt={alt} width={blocksWidth(lit.length)} height={SQ_H} />
    ) : (
      <Box flexDirection="row">{meter(Text, blockDots(lit), color, share === null ? null : Math.min(lit.length, Math.max(0, Math.round(share * lit.length))))}</Box>
    )
  const dim = (text: string) => <Text color="subtle">{text}</Text>

  type Figures = { l: Limit; pace: number | null; color: string; points: [number, number][]; burn: number | null; k: Kept | undefined }
  const figures: Figures[] = v.limits.map(l => {
    const pace = l.resetsAt === null ? null : elapsedShare(l.resetsAt, l.windowMs, v.now)
    const k = v.kept[l.label]
    const points = k === undefined ? [] : pointsOf(k.readings, l)
    const burn = l.resetsAt === null || l.windowMs === null ? null : burnRate(points, l.exact, l.resetsAt - l.windowMs, v.now, s.burnLookbackMs)
    return { l, pace, color: limitLevel(l.percent, pace, s), points, burn, k }
  })

  // A limit's head: the exact percent, and the window's whole span.
  const headLines = ({ l }: Figures): Lines => [
    l.resetsAt !== null && [`resets ${fullAt(l.resetsAt)}`, SEP, `in ${resetIn(l.resetsAt - v.now)}`],
    l.resetsAt !== null && l.windowMs !== null && [soft('opened '), fullAt(l.resetsAt - l.windowMs)],
    [
      `${Math.round(l.exact * 10) / 10}%`,
      soft(` used${l.windowMs === null ? '' : ` of a ${l.windowMs >= DAY ? `${Math.round(l.windowMs / DAY)}-day` : `${Math.round(l.windowMs / 3_600_000)}-hour`} window`}`),
      SEP,
      `${Math.round((100 - l.exact) * 10) / 10} pts`,
      soft(' left'),
    ],
  ]
  // A verdict's figures: the window's time against its use, the rates, how
  // long the rest lasts, and the rule behind its color.
  const verdictLines = ({ l, pace, burn }: Figures, verdict: Verdict): Lines => {
    if (pace === null || l.resetsAt === null || l.windowMs === null) return []
    const ahead = Math.round(l.percent - pace * 100)
    const average = pace < 0.02 ? null : l.exact / ((pace * l.windowMs) / 3_600_000)
    const rate = s.runwayBasis === 'recent' ? burn : average
    const left = runwayMs(l.exact, rate)
    const msLeft = Math.max(0, l.resetsAt - v.now)
    const rates: Piece[][] = []
    if (burn !== null) rates.push([`${perHour(burn)}/h`, soft(` over the last ${Math.round(s.burnLookbackMs / 60_000)}m`)])
    if (average !== null) rates.push([`${perHour(average)}/h`, soft(' on average')])
    return [
      [`${Math.round(pace * 100)}% of the window gone`, SEP, ahead === 0 ? 'on pace' : { t: `${Math.abs(ahead)} pts ${ahead > 0 ? 'ahead of' : 'behind'} it`, s: ahead > 0 ? 'warn' : 'good' }],
      joined(rates),
      rate !== null && left !== null && [soft('at '), `${perHour(rate)}/h`, soft(', full in '), resetIn(left), soft(': '), left < msLeft ? { t: 'before the reset', s: 'bad' } : { t: 'after the reset', s: 'good' }],
      whyLine(verdict.why),
    ]
  }

  // The pane line each section starts on, for the cards that rise from it.
  let line = 0
  const sections = figures.map(f => {
    const { l, pace, color, burn } = f
    const verdict = verdictOf(l, pace, burn, v.now, s)
    const at = line
    const bar = s.gauge === 'bar' ? 1 : 0
    line += 1 + bar + (verdict === null ? 0 : 1) + (compact ? 0 : 1)
    const head = tipAt(`${l.label}:head`, at, headLines(f))
    const said = verdict === null ? null : tipAt(`${l.label}:verdict`, at + bar + 1, verdictLines(f, verdict), verdictTone(verdict.color))
    return (
      <Box key={l.label} flexDirection="column">
        {row(
          'head',
          [
            <Box width={3}>
              <Text bold>{l.label}</Text>
            </Box>,
            <Text color={color} bold>
              {l.percent}%
            </Text>,
            l.resetsAt !== null && dim(`resets ${resetText(l.resetsAt, l.windowMs, v.now, s)}`),
            head.card,
          ],
          undefined,
          head.hover,
        )}
        {s.gauge === 'bar' &&
          (Svg !== null ? (
            <Svg source={wideBarSvg(l.percent, color, pace, widthPx)} alt={`${l.label} limit ${l.percent}%`} width={wideBarWidth(widthPx)} height={SQ_H} />
          ) : (
            <Box flexDirection="row">{meter(Text, dotsAcross(l.percent, columns - 2), color, pace === null ? null : Math.round(pace * (columns - 2)))}</Box>
          ))}
        {verdict !== null &&
          row(
            'verdict',
            [
              <Box width={3} />,
              <Text color={verdict.color}>{verdict.lead}</Text>,
              verdict.tail !== '' && dim(verdict.tail),
              said?.card,
            ],
            1,
            said?.hover,
          )}
      </Box>
    )
  })

  // The details: a row per figure, a cell per limit; a row whose cells all
  // have nothing to say is left out. `tipOf` is a drawn cell's hover card,
  // rising `rise` lines.
  const rows: { label: string; cells: unknown[]; tips: Lines[]; rise: number }[] = []
  const addRow = (label: string, cell: (f: Figures) => unknown, tipOf: (f: Figures) => Lines = () => [], rise = 1) => {
    const cells = figures.map(cell)
    if (cells.some(c => c !== null && c !== false)) rows.push({ label, cells, tips: figures.map((f, i) => (cells[i] === null || cells[i] === false ? [] : tipOf(f))), rise })
  }
  const pts = (n: number) => `${Math.round(n * 10) / 10}`
  if (v.showDetails) {
    addRow(
      'This window',
      ({ l, color, points }) => {
        if (l.resetsAt === null || l.windowMs === null) return null
        if (Svg !== null) return <Svg source={sparkSvg(points, l.resetsAt, l.windowMs, v.now, color, s, VALUE_W * CELL_PX - 16)} alt={`${l.label} readings this window`} width={VALUE_W * CELL_PX - 16} height={SPARK_H} />
        const { dots, upTo } = sparkDots(points, l.resetsAt, l.windowMs, v.now, VALUE_W - 4)
        return <Box flexDirection="row">{meter(Text, dots, color, upTo)}</Box>
      },
      ({ l, pace, points }) => {
        if (l.resetsAt === null || l.windowMs === null) return []
        const long = l.windowMs > DAY
        const first = points[0]
        const last = points[points.length - 1]
        const end = pace === null || pace < 0.02 || l.exact <= 0 ? null : l.exact / pace
        const ends: Piece[] | null =
          end === null
            ? null
            : end <= 100
              ? [soft('about '), `${Math.round(end)}%`, soft(' at the reset')]
              : ['100%', soft(' at '), clockAt(l.resetsAt - l.windowMs + ((pace ?? 1) * 100 * l.windowMs) / l.exact, long, s), soft(', '), { t: 'before the reset', s: 'bad' }]
        return [
          first === undefined || last === undefined
            ? 'No readings kept this window yet'
            : points.length === 1
              ? `1 reading, ${last[1]}% at ${clockAt(last[0], long, s)}`
              : [plural(points.length, 'reading'), SEP, `${clockAt(first[0], long, s)} to ${clockAt(last[0], long, s)}`, SEP, `last ${last[1]}%`],
          Svg !== null
            ? joined([...(s.paceGuide ? [[soft('dashed: '), 'an even pace to 100%']] : []), [soft('mark: '), 'now']])
            : [soft('a cell per '), resetIn(l.windowMs / Math.max(1, VALUE_W - 4)), soft(' of the window'), SEP, '|', soft(' marks now')],
          ends !== null && [soft(Svg !== null && s.projectionLine ? 'dotted: this pace, ' : 'this pace: '), ...ends],
        ]
      },
      Svg !== null ? Math.ceil(SPARK_H / ROW_PX) : 1,
    )
    if (s.burnRate) {
      addRow(
        'Burning',
        ({ burn }) => burn !== null && burn > 0 && row(null, [<Text>{perHour(burn)}/h</Text>, dim(`last ${Math.round(s.burnLookbackMs / 60_000)}m`)], 1),
        ({ l, burn }) => {
          if (burn === null || l.resetsAt === null || l.windowMs === null) return []
          const opened = l.resetsAt - l.windowMs
          const from = Math.max(opened, v.now - s.burnLookbackMs)
          const since = from === opened ? `since the window opened, ${clockAt(from, v.now - from > DAY, s)}` : `since ${clockAt(from, false, s)}`
          return [`${burn.toFixed(2)} pts an hour`, [`+${pts((burn * (v.now - from)) / 3_600_000)} pts`, soft(` ${since}`)], [soft('at '), `${l.exact}%`, soft(' now')]]
        },
      )
    }
    if (s.budget) {
      // Only where it bites: past the target, or under twice what the limit
      // goes at now.
      addRow(
        `To end at ${s.budgetTarget}%`,
        ({ l, pace, burn }) => {
          if (l.resetsAt === null || l.windowMs === null || pace === null || pace < 0.02) return null
          const budget = hourlyBudget(l.exact, s.budgetTarget, Math.max(0, l.resetsAt - v.now))
          if (budget === null) return <Text color="error">past it</Text>
          const going = Math.max(burn ?? 0, l.exact / ((pace * l.windowMs) / 3_600_000))
          return budget <= going * 2 && <Text color={budget < going ? 'warning' : 'text'}>under {perHour(budget)}/h</Text>
        },
        ({ l, pace, burn }) => {
          if (l.resetsAt === null || l.windowMs === null || pace === null || pace <= 0) return []
          const msLeft = Math.max(0, l.resetsAt - v.now)
          const budget = hourlyBudget(l.exact, s.budgetTarget, msLeft)
          if (budget === null) return [[`${l.exact}% now, `, { t: `past the ${s.budgetTarget}% target`, s: 'bad' }], [resetIn(msLeft), soft(' to the reset')]]
          const average = l.exact / ((pace * l.windowMs) / 3_600_000)
          const going = Math.max(burn ?? 0, average)
          return [
            `${budget.toFixed(2)} pts an hour ends the window at ${s.budgetTarget}%`,
            [
              soft('going at '),
              budget < going ? { t: going.toFixed(2), s: 'warn' } : going.toFixed(2),
              soft(` an hour: ${going === average ? "the window's average" : `the last ${Math.round(s.burnLookbackMs / 60_000)}m`}`),
            ],
            [`${pts(s.budgetTarget - l.exact)} pts`, soft(` to ${s.budgetTarget}%, `), resetIn(msLeft), soft(' to the reset')],
          ]
        },
      )
    }
    const mine = (f: Figures) => (f.l.resetsAt === null ? [] : sessionTurns(f.k?.turns ?? null, f.l.resetsAt, v.session.id, v.session.startedAt))
    if (s.turnCosts) {
      addRow(
        'Per turn',
        f => {
          const recent = mine(f).slice(-s.turnCount)
          if (recent.length === 0 || recent.every(t => t.delta === 0)) return null
          const deltas = recent.map(t => t.delta)
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
          return row(
            null,
            [
              s.turnShape === 'bars' ? bar(`${f.l.label} per turn`, seriesBlocks(deltas), f.color, null, 'blocks') : <Text>{deltas.map(d => `+${d.toFixed(1)}`).join(' ')}</Text>,
              dim(`avg ${avg.toFixed(1)}%`),
            ],
            1,
          )
        },
        f => {
          const recent = mine(f).slice(-s.turnCount)
          const top = recent.reduce<(typeof recent)[number] | null>((a, t) => (a === null || t.delta > a.delta ? t : a), null)
          if (top === null) return []
          const long = f.l.windowMs !== null && f.l.windowMs > DAY
          const all = f.k?.turns
          const others = all != null && f.l.resetsAt !== null && isSameWindow(all.resetsAt, f.l.resetsAt) ? all.turns.filter(t => t.session !== v.session.id) : []
          return [
            [`${plural(recent.length, 'turn')}, +${pts(recent.reduce((a, t) => a + t.delta, 0))} in all`, SEP, `max +${top.delta.toFixed(1)} at ${clockAt(top.at, long, s)}`],
            s.turnShape === 'bars' && [soft('last: '), recent.slice(-8).map(t => `+${t.delta.toFixed(1)}`).join(' ')],
            [soft('latest '), ...joined(recent.slice(-3).reverse().map(t => [soft(`${clockAt(t.at, long, s)} `), `+${t.delta.toFixed(1)}`]))],
            others.length > 0 && [soft('other sessions: '), `${plural(others.length, 'turn')}, +${pts(others.reduce((a, t) => a + t.delta, 0))}`, soft(' this window')],
          ]
        },
      )
    }
    if (s.sessionShare || s.dollars === 'per-point') {
      addRow(
        'This session',
        f => {
          const ours = Math.round(mine(f).reduce((a, t) => a + t.delta, 0) * 10) / 10
          if (ours <= 0) return null
          const cost = s.dollars === 'per-point' && v.session.costUsd !== null && ours >= 0.5 ? `$${(v.session.costUsd / ours).toFixed(2)} per 1%` : null
          return row(null, [s.sessionShare && <Text>{ours.toFixed(1)} of {f.l.exact} pts</Text>, cost !== null && dim(cost)], 1)
        },
        f => {
          const turns = mine(f)
          const ours = turns.reduce((a, t) => a + t.delta, 0)
          const { costUsd, startedAt } = v.session
          return [
            [plural(turns.length, 'turn'), SEP, `${f.l.exact > 0 ? pct(Math.min(1, ours / f.l.exact)) : '0%'} of this window's use`],
            costUsd !== null && [`$${costUsd.toFixed(2)}`, soft(' spent'), ...(startedAt === null ? [] : [soft(' since '), clockAt(startedAt, v.now - startedAt > DAY, s)])],
            [`${pts(Math.max(0, f.l.exact - ours))} pts`, soft(' from other sessions or earlier')],
          ]
        },
      )
    }
    if (s.history) {
      addRow(
        'Past windows',
        ({ l, k }) => {
          const past = (k?.history ?? []).slice(-s.historyCount)
          if (past.length === 0) return null
          const values = past.map(h => (s.historyMetric === 'peak' ? h.peak : h.last))
          const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          return row(
            null,
            [bar(`${l.label} past windows`, values.map(p => Math.min(10, Math.max(p > 0 ? 1 : 0, Math.round(p / 10)))), values.map(p => limitLevel(p, null, s)), null, 'blocks'), dim(`avg ${avg}%`)],
            1,
          )
        },
        ({ k }) => {
          const past = (k?.history ?? []).slice(-s.historyCount)
          const first = past[0]
          const last = past[past.length - 1]
          if (first === undefined || last === undefined) return []
          const avg = (of: 'peak' | 'last') => Math.round(past.reduce((a, h) => a + h[of], 0) / past.length)
          const high = past.reduce((a, h) => (h.peak > a.peak ? h : a))
          const peakEnd = (lead: string, peak: number, end: number, tail: string): Piece[] => [soft(`${lead}peak `), `${peak}%`, SEP, `${end}%`, soft(tail)]
          if (past.length === 1) return [`1 window, ended ${fullAt(last.resetsAt)}`, peakEnd('', last.peak, last.last, ' at its end')]
          return [
            `${plural(past.length, 'window')}, ended ${dayText(first.resetsAt)} to ${dayText(last.resetsAt)}`,
            peakEnd('latest: ', last.peak, last.last, ' at its end'),
            peakEnd('on average: ', avg('peak'), avg('last'), ' at the end'),
            [soft('highest: '), `${high.peak}%`, soft(', ended '), fullAt(high.resetsAt)],
          ]
        },
      )
    }
    if (s.idleHint) {
      addRow(
        'If you stop',
        ({ l }) => {
          if (l.resetsAt === null) return null
          return l.windowMs !== null && l.windowMs > DAY ? dim(`holds ${l.percent}% to ${clockAt(l.resetsAt, true, s)}`) : dim(`clears at ${clockAt(l.resetsAt, false, s)}`)
        },
        ({ l }) => (l.resetsAt === null ? [] : [`back to 0% on ${fullAt(l.resetsAt)}`, [soft('in '), resetIn(l.resetsAt - v.now), soft(', '), `${l.exact}%`, soft(' falling away')]]),
      )
    }
  }
  // The weekly limit's activity: the grid of days by hours, then the cross
  // of the spend by model family beside what stands out.
  const activity = () => {
    const a = activityFigures(v.days, v.models)
    const m = a.models
    if (a.total <= 0 && m.total <= 0) return null
    const top = m.total > 0 ? MODEL_FAMILIES[m.shares.indexOf(Math.max(...m.shares))] : null
    // Each index with its value, the largest first, the empty left out.
    const ranked = (values: number[]) =>
      values
        .map((x, i) => [i, x] as const)
        .filter(([, x]) => x > 0)
        .sort((p, q) => q[1] - p[1])
    const hours = ranked(a.hours)
    const weekdays = ranked(weekdaySums(v.days))
    const keys = Object.keys(v.days).sort()
    const dayTotals = keys.map(k => [k, (v.days[k] ?? []).reduce((p, q) => p + q, 0)] as const)
    const bestDay = dayTotals.reduce<(typeof dayTotals)[number] | null>((p, d) => (p === null || d[1] > p[1] ? d : p), null)
    const dollars = (share: number) => `$${(share * m.total).toFixed(2)}`
    const spend = MODEL_FAMILIES.map((f, i) => [MODEL_NAMES[f], m.shares[i] ?? 0] as const)
      .filter(([, x]) => x > 0)
      .sort((p, q) => q[1] - p[1])
      .map(([name, x]) => [`${name} ${dollars(x)}`])
    const modelDays = Object.keys(v.models).length
    // Ranked entries as pieces: the top one plain when `top`, the runner-ups dim.
    const ranks = (list: string[], top: boolean) => joined(list.map((t, i) => [i === 0 && top ? t : soft(t)]))
    const hourList = (list: (readonly [number, number])[], top: boolean) => ranks(list.map(([h, x]) => `${hourText(h, s)} ${pts(x)}`), top)
    const dayList = (list: (readonly [number, number])[], top: boolean, value: (x: number) => string) => ranks(list.map(([d, x]) => `${WEEKDAYS[d]} ${value(x)}`), top)
    // A family's name, dim, and its spend.
    const familySpend = (families: readonly (typeof MODEL_FAMILIES)[number][], from: number) => joined(families.map((f, i) => [soft(`${MODEL_NAMES[f]} `), dollars(m.shares[i + from] ?? 0)]))
    // A fact's row: its pieces, then its card; lit under the pointer only
    // when it has one.
    const fact = (key: string, parts: unknown[], card: unknown = null) => row(key, [...parts, card], 1, lit(card))
    const facts = [
      a.busiestHour !== null &&
        fact(
          'hour',
          [dim('Busiest hour'), <Text>{hourText(a.busiestHour, s)}</Text>],
          tip([`${pts(a.hours[a.busiestHour] ?? 0)} pts in that hour, ${pct((a.hours[a.busiestHour] ?? 0) / a.total)} of it`, hours.length > 1 && [soft('then '), ...hourList(hours.slice(1, 4), false), soft(' pts')], 'local hours, over every day kept'], { side: 'left' }),
        ),
      a.weekday !== null &&
        fact(
          'day',
          [dim('Busiest day'), <Text>{a.weekday.name}</Text>, dim(pct(a.weekday.share) + ' of it')],
          tip([`${pts(weekdays[0]?.[1] ?? 0)} pts on ${a.weekday.name}s`, weekdays.length > 1 && [soft('then '), ...dayList(weekdays.slice(1, 4), false, x => pct(x / a.total))]], { side: 'left' }),
        ),
      a.total > 0 &&
        fact(
          'total',
          [dim('Weekly limit'), <Text>{Math.round(a.total)} pts</Text>, dim('over ' + a.dayCount + (a.dayCount === 1 ? ' day' : ' days'))],
          tip(
            [
              `${pts(a.total / Math.max(1, a.dayCount))} pts a day on average`,
              bestDay !== null && [soft('most on '), dayText(dateOfKey(bestDay[0])), soft(': '), `${pts(bestDay[1])} pts`],
              keys[0] !== undefined && [soft('kept since '), dayText(dateOfKey(keys[0]))],
            ],
            { side: 'left' },
          ),
        ),
      top !== null &&
        fact(
          'model',
          [dim('Mostly'), <Text>{MODEL_NAMES[top]}</Text>, dim(pct(Math.max(...m.shares)) + ' of $' + m.total.toFixed(2) + ' by model')],
          tip([joined(spend), m.other > 0 && [soft('other '), dollars(m.other)], [soft('over '), plural(modelDays, 'day'), soft(' measured')]], { side: 'left' }),
        ),
      m.other > 0 && fact('other', [dim('Other models'), <Text>{pct(m.other)}</Text>], tip([`${dollars(m.other)} of $${m.total.toFixed(2)}`, 'models of no known family; their names are not kept'], { side: 'left' })),
      m.total <= 0 && fact('model', [dim('By model'), dim('measured from the next response on')]),
    ]
    if (Svg === null) {
      return (
        <Box key="activity" flexDirection="column">
          <Text bold>Activity</Text>
          {a.total > 0 &&
            gridText(Box, Text, v.days, v.now, columns, (from, values, dates) => {
              const best = values.indexOf(Math.max(...values))
              const day = dates[best]
              const sum = values.reduce((p, q) => p + q, 0)
              if (sum <= 0 || day === undefined) return null
              return tip([
                `${hourText(from, s)} to ${hourText(from + SLOT_HOURS, s)}: ${pts(sum)} pts over ${plural(values.length, 'day')}`,
                [soft('on '), `${values.filter(x => x > 0).length}`, soft(' of those days')],
                [soft('most on '), dayText(day.getTime()), soft(': '), `${pts(values[best] ?? 0)} pts`],
              ])
            })}
          {m.total > 0 &&
            modelsText(Box, Text, m.shares, i => {
              const family = MODEL_FAMILIES[i]
              if (family === undefined) return null
              const used = Object.values(v.models).filter(d => (d[family] ?? 0) > 0).length
              return tip([`${dollars(m.shares[i] ?? 0)} of $${m.total.toFixed(2)}`, [soft('on '), `${used}`, soft(' of '), plural(modelDays, 'day'), soft(' measured')]])
            })}
          {facts}
        </Box>
      )
    }
    const g = a.total > 0 ? gridSvg(v.days, v.now, widthPx) : null
    // The grid's busiest cell, as drawn: its slot, its day and what it took.
    const busiest = () => {
      const { cells, dates } = grid(v.days, v.now, daysAcross(widthPx))
      let best: [number, number, number] = [0, 0, 0]
      cells.forEach((r, slot) => r.forEach((x, d) => (x > best[2] ? (best = [slot, d, x]) : null)))
      const day = dates[best[1]]
      return best[2] <= 0 || day === undefined
        ? null
        : [soft('busiest: '), `${dayText(day.getTime())}, ${hourText(best[0] * SLOT_HOURS, s)} to ${hourText((best[0] + 1) * SLOT_HOURS, s)}`, soft(': '), `${pts(best[2])} pts`]
    }
    // An image with its card, lit under the pointer only when it has one.
    const withCard = (key: string, image: unknown, card: unknown) => (
      <Box key={key} flexDirection="column" hover={lit(card)}>
        {image}
        {card}
      </Box>
    )
    return (
      <Box key="activity" flexDirection="column" rowGap={0.5}>
        <Text bold>Activity</Text>
        {g !== null &&
          withCard(
            'grid-tip',
            <Svg source={g.source} alt="The weekly limit by day and hour" height={g.height} />,
            tip(
              [
                hours.length > 0 && ['top hours: ', ...hourList(hours.slice(0, 3), true), soft(' pts')],
                weekdays.length > 0 && [soft('top days: '), ...dayList(weekdays.slice(0, 4), true, pts), soft(' pts')],
                busiest(),
                keys[0] !== undefined && [plural(keys.length, 'day'), soft(' kept, since '), dayText(dateOfKey(keys[0]))],
              ],
              { bottom: Math.ceil(g.height / ROW_PX) },
            ),
          )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={0.5}>
          {facts.filter(f => f !== false)}
        </Box>
        {m.total > 0 && (
          <Box flexDirection="row" justifyContent="center">
            {withCard(
              'cross-tip',
              <Svg source={crossSvg(m.shares)} alt="The spend by model family" width={300} height={200} />,
              tip(
                [
                  `$${m.total.toFixed(2)} over ${plural(modelDays, 'day')} measured`,
                  familySpend(MODEL_FAMILIES.slice(0, 2), 0),
                  familySpend(MODEL_FAMILIES.slice(2), 2),
                  m.other > 0 && [soft('other '), dollars(m.other), soft(': models of no known family')],
                ],
                { bottom: Math.ceil(200 / ROW_PX) },
              ),
            )}
          </Box>
        )}
      </Box>
    )
  }
  const cell = (key: string, width: number, child: unknown, hover?: Hover) => (
    <Box key={key} width={width} flexShrink={0} hover={hover}>
      {child}
    </Box>
  )

  return (
    <Box flexDirection="column" rowGap={compact ? 0 : 1}>
      {sections}
      {v.showDetails && rows.length > 0 && (
        <Box flexDirection="column" rowGap={compact ? 0 : 0.5}>
          <Box flexDirection="row">
            {cell('label', LABEL_W, null)}
            {figures.map(f => cell(f.l.label, VALUE_W, <Text bold>{f.l.label}</Text>))}
          </Box>
          {rows.map(r => (
            <Box key={r.label} flexDirection="row" alignItems="center">
              {cell('label', LABEL_W, dim(r.label))}
              {r.cells.map((c, i) => {
                const card = c === null || c === false ? null : tip(r.tips[i] ?? [], { bottom: r.rise, side: i === r.cells.length - 1 ? 'right' : 'left' })
                return cell(String(i), VALUE_W, c === null || c === false ? null : [c, card], card === null ? undefined : LIT)
              })}
            </Box>
          ))}
          {s.dollars === 'total' && v.session.costUsd !== null && dim(`$${v.session.costUsd.toFixed(2)} spent this session`)}
        </Box>
      )}
      {v.showDetails && s.heatmap && activity()}
      <Box flexDirection="row">
        <Box key="tip:details">
          <Button key="details" plain dimColor hotkey="d" label={v.showDetails ? 'fewer details' : 'details'} onPress={v.onToggleDetails} />
          {/* Above the button and clear of it: on the desktop it stands taller than a line. */}
          {line >= 3 && tip([[`${v.showDetails ? 'Hides' : 'Shows'} the ${figures.map(f => f.l.label).join(' and ')} details `, kbd('d')]], { bottom: term ? 1 : 2, side: 'left' }, 'action')}
        </Box>
      </Box>
      {/* A pane is only as tall as its tree on the desktop: room for a revealed card that runs past the button. */}
      {!v.showDetails && !term && reach > line + 2 && <Box key="tip-room" height={reach - line - 2} flexShrink={0} />}
      {reveals}
    </Box>
  )
}

const pct = (share: number) => `${Math.round(share * 100)}%`

function perHour(points: number) {
  return `${points < 10 ? points.toFixed(1) : Math.round(points)}%`
}

// `16:47, in 2h05m`, or either half alone, as the settings say.
export function resetText(resetsAt: number, windowMs: number | null, now: number, s: Settings) {
  const at = clockAt(resetsAt, windowMs !== null && windowMs > DAY, s)
  const inText = `in ${resetIn(resetsAt - now)}`
  return s.resetAs === 'absolute' ? at : s.resetAs === 'relative' ? inText : `${at}, ${inText}`
}

// `16:47` or `4:47pm`, and `Wed 09:12` with the day, in local time.
export function clockAt(at: number, withDay: boolean, s: Pick<Settings, 'clock'>) {
  const t = new Date(at)
  const m = String(t.getMinutes()).padStart(2, '0')
  const hm = s.clock === '12h' ? `${t.getHours() % 12 || 12}:${m}${t.getHours() < 12 ? 'am' : 'pm'}` : `${String(t.getHours()).padStart(2, '0')}:${m}`
  return withDay ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]} ${hm}` : hm
}

function hourText(hour: number, s: Pick<Settings, 'clock'>) {
  return s.clock === '12h' ? `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}` : `${String(hour).padStart(2, '0')}:00`
}

const SPARK_H = 48

// The readings as a line across the window, the area under it filled, against
// the dashed line of an even pace to 100%, a dotted line from now to where
// the pace so far ends, and a mark where the window stands now.
export function sparkSvg(points: [number, number][], resetsAt: number, windowMs: number, now: number, color: string, s: Pick<Settings, 'sparkFill' | 'paceGuide' | 'projectionLine'>, width = 240) {
  const SPARK_W = Math.max(120, Math.round(width))
  const start = resetsAt - windowMs
  const share = (t: number) => Math.min(1, Math.max(0, (t - start) / windowMs))
  const x = (sh: number) => Math.round(sh * SPARK_W * 10) / 10
  const y = (p: number) => Math.round((SPARK_H - 2 - (Math.min(100, p) / 100) * (SPARK_H - 4)) * 10) / 10
  const fill = svgColor(color)
  const nowShare = share(now)
  const line = [[start, 0] as [number, number], ...points]
  const coords = line.map(([t, p]) => `${x(share(t))},${y(p)}`)
  const last = line[line.length - 1][1]
  const parts: string[] = []
  if (s.paceGuide) parts.push(`<line class="p" x1="0" y1="${y(0)}" x2="${SPARK_W}" y2="${y(100)}" stroke-width="1" stroke-dasharray="3 3"/>`)
  if (points.length > 0) {
    // The line runs on flat to now: the last reading holds until the next.
    coords.push(`${x(nowShare)},${y(last)}`)
    if (s.sparkFill === 'area') parts.push(`<polygon fill="${fill}" opacity="0.18" points="${coords.join(' ')} ${x(nowShare)},${y(0)} 0,${y(0)}"/>`)
    parts.push(`<polyline fill="none" stroke="${fill}" stroke-width="2" stroke-linejoin="round" points="${coords.join(' ')}"/>`)
  }
  if (s.projectionLine && last > 0 && nowShare >= 0.02) {
    // The pace so far run on: to the reset, or to where it reaches 100%.
    const end = last / nowShare
    const toShare = end <= 100 ? 1 : (nowShare * 100) / last
    parts.push(`<line x1="${x(nowShare)}" y1="${y(last)}" x2="${x(toShare)}" y2="${y(Math.min(100, end))}" stroke="${fill}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.8"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}">
<style>.k{fill:#e4e4e2}.p{stroke:#8a8a8a}.n{fill:#1f1f1f}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.p{stroke:#6a6a6a}.n{fill:#ececec}}</style>
<rect class="k" width="${SPARK_W}" height="${SPARK_H}" rx="3"/>
${parts.join('\n')}
<rect class="n" x="${Math.max(0, x(nowShare) - 0.75)}" y="0" width="1.5" height="${SPARK_H}"/>
</svg>`
}
