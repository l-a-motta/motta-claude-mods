// The Branches pane: a header with when it last read and its own Refresh,
// then two sections, each with a picker:
//   Me   your branch against main (two lines), or where your work sits
//   All  every branch as lanes (text art in the terminal), or a subway map
// Pure drawing over what register.tsx read. On the desktop the graphs are
// static SVG images, one per row so each row stays pressable; a hover card is
// a hidden Box its row reveals; a branch's rows share one hover scope. Moved
// here from changes-drill's History section, which keeps Current.

import type { Commit, Graph, Line, Work } from './history.ts'
import { MAIN, YOU, clock, colorOf, crossing, layout, mainLine, prOf, shortSubject, subway, SYNC_MERGE, takenIn, workOf } from './history.ts'
import { ago, stageWord, statusColor, statusLetter, statusWord } from './git.ts'
import type { Row } from './register.tsx'

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The pane draws at
// the richest level that fits: 0 every card, 1 action and status cards only,
// 2 no cards, 3 the All lanes and the places' commit lists cut to 15 commits
// (a line says how many are hidden), 4 the subway's Stops folded too.
export const BUDGET = 1000
// Characters of the serialized tree, an inline SVG's source included.
export const CHAR_BUDGET = 200_000
export const TOP = 4
// The commits a list keeps from level 3.
const CAP = 15
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
  for (let at = 1; at <= top && (countNodes(tree) > BUDGET || JSON.stringify(tree).length > CHAR_BUDGET); at += 1) tree = draw(at)
  return tree
}
// The level being drawn: the card helpers read it, set before each draw.
let level = 0
export function setLevel(n: number) {
  level = n
}
// Whether a card of this tone is drawn at the current level.
const keeps = (tone: Tone) => level < 1 || (level < 2 && tone !== 'info')

export type HistoryReading = {
  commits: Commit[]
  head: string | null
  branch: string
  // The base line (origin's default branch, else a local main) and its tip.
  base: string | null
  main: string | null
  fork: string | null
  ahead: number
  behind: number
  behindList: Commit[]
  upstream: string | null
  unpushed: number | null
  at: number
}

export type Picks = { me: 'tracks' | 'places'; all: 'lanes' | 'subway' }

export type ViewArgs = {
  Box: any
  Text: any
  Button: any
  Svg?: any
  Select?: any
  surface: string
  // The pane body's width in cells: the sections are sized to it, and a
  // label that would not fit is cut, since a desktop Button does not shrink.
  columns: number
  history: HistoryReading | null | undefined
  isReading: boolean
  rows: readonly Row[]
  picks: Picks
  open: ReadonlySet<string>
  files: ReadonlyMap<string, [number, number, string][] | 'reading'>
  now: number
  // The ladder's level (see BUDGET): from 3 the lists are cut.
  level: number
  on: {
    refresh: () => void
    pick: (section: keyof Picks, value: string) => void
    toggle: (key: string, commit?: string) => void
  }
}

// The desktop pane's own ground (dark theme), measured: what a hollow dot is filled with.
const BG = '#1a1a19'
const FG = '#e9e7e2'
export const DIM = '#9c9a94'
const CARD = '#34332f'
const LIT = '#ffffff10'
const RULE = '#ffffff1f'
const H = 24 // a graph row, in CSS pixels
const LW = 14 // a lane's width, in CSS pixels
const CELL = 7.9 // CSS pixels per cell, as measured on the desktop
const LIGHT = { claude: { fg: '#8db4f0', bg: '#1d3150' }, ref: { fg: '#a9c1fb', bg: '#22304f' }, here: { fg: '#f1c98c', bg: '#3e2f17' }, cloud: { fg: '#b9c0cc', bg: '#2b2f36' } }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const lx = (lane: number) => 8 + lane * LW
const svgDoc = (w: number, hr: number, body: string, viewBox = `0 0 ${w} ${hr}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hr}" viewBox="${viewBox}">${body}</svg>`
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Ctx = ViewArgs & { graphic: boolean; term: boolean; mobile: boolean }

export function branchesPane(args: ViewArgs) {
  const { Box, Text, Button } = args
  setLevel(args.level)
  const ctx: Ctx = { ...args, graphic: !!args.Svg && args.surface !== 'terminal', term: args.surface === 'terminal', mobile: args.surface === 'mobile' }
  const hr = args.history
  const status = args.isReading ? 'reading…' : hr ? `read ${clock(hr.at, args.now)} · GitHub as of last fetch` : ''
  // The head's card: Refresh's press first, then what the reading holds.
  const headTip = hoverCard(
    Box,
    args.surface,
    { right: 0 },
    cardLines(Text, [
      'Refresh re-reads the branches and commits from git',
      hr ? [plural(hr.commits.length, 'commit'), { t: ' read, newest first', s: 'd' }, SEP, { t: 'nothing fetched', s: 'd' }] : hr === null ? 'No commits read: no repository, or none yet' : 'Not read yet',
      hr && [{ t: 'Base ', s: 'd' }, hr.base ?? 'none found', ...atId(hr.main)],
      hr && [{ t: 'On ', s: 'd' }, hr.branch, ...atId(hr.head), SEP, ...(hr.upstream ? [{ t: 'tracks ', s: 'd' } as Piece, hr.upstream] : [{ t: 'not pushed yet', s: 'warn' } as Piece])],
    ]),
    'action',
  )
  const head = (
    <Box key="branches-head" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={0.5}>
      <Text bold>Branches</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {status}
        </Text>
        <Button key="branches-refresh" plain dimColor label="↻ Refresh" onPress={() => args.on.refresh()} />
      </Box>
      {headTip}
    </Box>
  )
  if (hr === undefined)
    return (
      <Box key="branches" flexDirection="column" width="100%" overflow="hidden">
        {head}
        <Box paddingX={0.5}>
          <Text dimColor>Reading the branches…</Text>
        </Box>
      </Box>
    )
  if (hr === null)
    return (
      <Box key="branches" flexDirection="column" width="100%" overflow="hidden">
        {head}
        <Box paddingX={0.5}>
          <Text dimColor>No branches: not a git repository, or no commits yet.</Text>
        </Box>
      </Box>
    )
  return (
    <Box key="branches" flexDirection="column" width="100%" overflow="hidden">
      {head}
      {section(ctx, 'me', 'Me', 'your branch and your work', args.picks.me === 'tracks' ? tracks(ctx, hr) : places(ctx, hr))}
      {section(ctx, 'all', 'All', 'every branch', args.picks.all === 'lanes' || ctx.term ? lanes(ctx, hr, args.picks.all === 'subway') : subwayView(ctx, hr))}
    </Box>
  )
}

const OPTIONS: Record<keyof Picks, [string, string][]> = {
  me: [
    ['tracks', 'You vs main'],
    ['places', "Where's my work"],
  ],
  all: [
    ['lanes', 'Lanes'],
    ['subway', 'Subway'],
  ],
}

// What each pick draws, for the picker's card.
const PICKED: Record<string, string> = {
  tracks: 'your branch beside main, with counts',
  places: 'files, branch, GitHub and main as boxes',
  lanes: 'every branch as a graph, a commit a row',
  subway: "main's merges as stops, branches as loops",
}

function section(ctx: Ctx, id: keyof Picks, name: string, sub: string, body: any) {
  const { Box, Text, Button, Select } = ctx
  const options = OPTIONS[id]
  // The picker's card opens 3 cells in from the right, clear of a ▸ above it.
  const picker =
    Select && !ctx.mobile ? (
      <Box key={`tip:pick-${id}`} flexShrink={0}>
        <Select key={`branches-pick-${id}`} value={ctx.picks[id]} options={options.map(([value, label]) => ({ value, label }))} onSelect={(v: string) => ctx.on.pick(id, v)} />
        {hoverCard(ctx.Box, ctx.surface, { right: 3 }, cardLines(ctx.Text, [`Switches ${name} between ${options.map(([, label]) => label).join(' and ')}`, ...options.map(([value, label]): CardLine => [label, { t: `: ${PICKED[value] ?? ''}`, s: 'd' }]), id === 'all' && ctx.term ? 'The terminal draws Subway as Lanes' : null]), 'action')}
      </Box>
    ) : (
      <Box flexDirection="row" columnGap={0.5}>
        {options.map(([value, label]) => (
          <Button key={`branches-pick-${id}-${value}`} dimColor={ctx.picks[id] !== value} label={label} onPress={() => ctx.on.pick(id, value)} />
        ))}
      </Box>
    )
  return (
    <Box key={`branches-${id}`} flexDirection="column" marginTop={1}>
      {ctx.term ? <Text dimColor>{'─'.repeat(40)}</Text> : <Box width="100%" height={0.06} backgroundColor={RULE} />}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={0.5} paddingY={ctx.term ? 0 : 0.4}>
        <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
          <Text bold>{name}</Text>
          <Text dimColor wrap="truncate-end">
            {sub}
          </Text>
        </Box>
        {picker}
      </Box>
      {body}
    </Box>
  )
}

// --- shared pieces ---------------------------------------------------------

function light(ctx: Ctx, key: string, word: string, tone: keyof typeof LIGHT) {
  const { Box, Text } = ctx
  const p = LIGHT[tone]
  if (ctx.term)
    return (
      <Text key={key} color={p.fg}>
        {word}
      </Text>
    )
  return (
    <Box key={key} flexShrink={0} backgroundColor={p.bg} paddingX={0.5}>
      <Text color={p.fg}>{word}</Text>
    </Box>
  )
}

// A hover card, hidden until its host is hovered: the nearest keyed Box, or
// with `scope` that hover group. It opens upward (`bottom`, the host's height
// in cells: a row drawn later would paint over one hanging below), or, from
// the pane's root and drawn last, downward from `top`. Offsets are whole cells;
// a negative `right` reaches past the host's right edge. None on a phone.
export type CardAt = { left?: number; right?: number; top?: number; bottom?: number; scope?: string; width?: number }

// Card text: a line is a string or a list of pieces; a piece is a string
// (plain) or text with a style. The first line is the headline, in bold; a
// later string line is dim. Labels dim, values plain, `·` fainter still.
type Style = 'b' | 'd' | 'f' | 'i' | 'good' | 'bad' | 'warn' | 'accent' | 'key' | 'tag' | 'tag-good' | 'tag-bad' | 'tag-warn'
export type Piece = string | { t: string; s: Style }
export type CardLine = string | Piece[]
export type CardTexts = readonly (CardLine | false | null | undefined)[]
// The card's kind, drawn as a bar down its left edge (the desktop) or as its
// border's color (the terminal): a local press, a drill-down, a status.
export type Tone = 'action' | 'info' | 'warn' | 'danger' | 'good'
const FAINT = '#6f6d68'
const GOOD = '#7fc97f'
const BAD = '#ef8a80'
const WARN = '#e7c06b'
const ACCENT = '#8db4f0'
const CHIP = '#ffffff1f'
const TONES: Record<Tone, string> = { action: ACCENT, info: FAINT, warn: WARN, danger: BAD, good: GOOD }
const TINT: Partial<Record<Style, [string, string]>> = { 'tag-good': [GOOD, '#7fc97f26'], 'tag-bad': [BAD, '#ef8a8026'], 'tag-warn': [WARN, '#e7c06b26'], tag: [FG, CHIP], key: [FG, CHIP] }
const INK: Partial<Record<Style, string>> = { d: DIM, f: FAINT, good: GOOD, bad: BAD, warn: WARN, accent: ACCENT }
// A faint separator piece.
export const SEP: Piece = { t: ' · ', s: 'f' }
// A path: the folder dim, the file name bold.
export const pathPieces = (path: string): Piece[] => {
  const i = path.lastIndexOf('/')
  return i < 0 ? [{ t: path, s: 'b' }] : [{ t: path.slice(0, i + 1), s: 'd' }, { t: path.slice(i + 1), s: 'b' }]
}
// A status word as a chip in its letter's hue: M amber, A green, D red.
export const statusTag = (letter: string): Style => (letter === 'M' ? 'tag-warn' : letter === 'A' ? 'tag-good' : letter === 'D' || letter === 'U' ? 'tag-bad' : 'tag')
export const plusMinus = (a: number, d: number): Piece[] => [{ t: `+${a}`, s: 'good' }, ' ', { t: `−${d}`, s: 'bad' }]
// ` at <id>`, the id bold; nothing without one.
const atId = (id: string | null | undefined): Piece[] => (id ? [{ t: ' at ', s: 'd' }, { t: id.slice(0, 7), s: 'b' }] : [])

// One line of a card: a plain string as one Text, pieces as nested Text, so
// it stays one line. Props left unset where they would be false: the tree
// stays light (a heavy one hung this pane on the desktop).
export function cardLine(Text: any, line: CardLine, i: number, wrap: string) {
  const head = i === 0
  if (typeof line === 'string')
    return (
      <Text key={`l${i}`} wrap={wrap} bold={head || undefined} color={head ? FG : DIM}>
        {line}
      </Text>
    )
  return (
    <Text key={`l${i}`} wrap={wrap} bold={head || undefined} color={FG}>
      {line.map((p, j) => {
        if (typeof p === 'string') return p
        const tint = TINT[p.s]
        if (tint)
          return (
            <Text key={j} color={tint[0]} backgroundColor={tint[1]} bold={p.s === 'key' || undefined}>
              {` ${p.t} `}
            </Text>
          )
        // In the bold headline, a dim or faint piece is not bold.
        return (
          <Text key={j} bold={p.s === 'b' || (head && (p.s === 'd' || p.s === 'f') ? false : undefined)} italic={p.s === 'i' || undefined} color={INK[p.s]}>
            {p.t}
          </Text>
        )
      })}
    </Text>
  )
}

// One row clear of its host: a pointer leaving the host crosses that row, so
// the card closes instead of holding the pointer over what it covers.
export function hoverCard(Box: any, surface: string, at: CardAt, lines: any[], tone: Tone = 'info') {
  if (surface === 'mobile' || !lines.length || !keeps(tone)) return null
  const term = surface === 'terminal'
  const whole = (n: number | undefined) => (n === undefined ? undefined : Math.round(n))
  return (
    <Box position="absolute" top={at.top === undefined ? undefined : whole(at.top)! + 1} bottom={at.top === undefined ? whole(at.bottom ?? 1)! + 1 : undefined} left={whole(at.left)} right={whole(at.right)} display="none" hover={at.scope ? { scope: at.scope, display: 'flex' } : { display: 'flex' }} flexDirection={term ? 'column' : 'row'} backgroundColor={CARD} paddingX={term ? 0.75 : 0} paddingY={term ? 0 : 0.3} width={at.width ?? 48} borderStyle={term ? 'round' : undefined} borderColor={term ? TONES[tone] : undefined}>
      {!term && <Box width={0.25} backgroundColor={TONES[tone]} />}
      {term ? (
        lines
      ) : (
        <Box flexDirection="column" paddingX={0.75} flexShrink={1} minWidth={0}>
          {lines}
        </Box>
      )}
    </Box>
  )
}

// A card's lines, one row each: the first the headline (the action, or the
// thing named), the rest labels dim and values plain.
export function cardLines(Text: any, texts: CardTexts, max = 5, wrap: 'wrap' | 'truncate-end' = 'truncate-end') {
  return texts
    .filter((t): t is CardLine => !!t && t.length > 0)
    .slice(0, max)
    .map((t, i) => cardLine(Text, t, i, wrap))
}

function card(ctx: Ctx, key: string, left: number, lines: any[], rise = 1, tone: Tone = 'info') {
  return hoverCard(ctx.Box, ctx.surface, { left: Math.max(0, left), bottom: rise }, lines, tone)
}

// A card at the side of a row, kept clear of what sits at the pane's right
// edge (the ▸ toggles, the pickers) when it opens on the left.
function sideCard(ctx: Ctx, side: Side, texts: CardTexts, tone: Tone = 'info') {
  if (!side) return null
  const width = Math.max(20, Math.min(48, (ctx.columns || 80) - 14))
  return hoverCard(ctx.Box, ctx.surface, side === 'left' ? { left: 0, width } : { right: 0, width }, cardLines(ctx.Text, texts), tone)
}
type Side = 'left' | 'right' | null

const whoWord = (who: string) => (who === 'claude' ? 'Claude' : who === 'agent' ? 'a subagent' : "Claude's shell")

// A changed file's card: its full path, what its letter means, who changed it.
function fileFacts(r: Row, now: number): CardTexts {
  return [
    pathPieces(r.path),
    [{ t: statusWord(r.status), s: statusTag(statusLetter(r.status)) }, SEP, r.isCommitted ? 'committed on this branch' : stageWord(r.status), ...(r.added || r.deleted ? [SEP, ...plusMinus(r.added ?? 0, r.deleted ?? 0)] : [])],
    r.touch ? [{ t: `Turn ${r.touch.turn}`, s: 'd' }, SEP, `${plural(r.touch.edits, 'edit')} by ${whoWord(r.touch.who)}`, ...(r.touch.at ? [SEP, { t: `last ${clock(r.touch.at, now)}`, s: 'd' } as Piece] : [])] : 'No edit by Claude recorded for it',
  ]
}

// `tags`: what the row's tags mean, a line of its own when it has any. The
// subject wraps; the id is bold, the subject italic.
function commitCard(ctx: Ctx, c: Commit, w: Work | undefined, tags?: string) {
  const { Text } = ctx
  const s = shortSubject(c.subject)
  const kind = prOf(c.subject) ? ' (a PR merged into main)' : SYNC_MERGE.test(c.subject) ? ' (took main in)' : ''
  const where: Piece[] = w?.key === 'main' ? ['main'] : w?.key === 'you' ? ['your branch'] : w?.pr !== undefined ? [{ t: `PR #${w.pr}`, s: 'b' }, SEP, w.name] : [w?.name ?? 'a branch']
  return [
    cardLine(Text, [{ t: c.id.slice(0, 7), s: 'b' }, SEP, { t: clock(c.at, ctx.now), s: 'd' }, SEP, { t: c.author.split(' ')[0] ?? c.author, s: 'd' }], 0, 'truncate-end'),
    cardLine(Text, [{ t: s.lead ? `${s.lead} · ${s.rest}` : c.subject, s: 'i' }], 1, 'wrap'),
    cardLine(Text, [{ t: 'On ', s: 'd' }, ...where, ...(kind ? [{ t: kind, s: 'd' } as Piece] : [])], 2, 'truncate-end'),
    tags ? cardLine(Text, tags, 3, 'truncate-end') : null,
    cardLine(Text, 'Click to see its files.', 4, 'truncate-end'),
  ]
}

// An opened commit's files, the biggest first; each row's card on `side`.
function fileLines(ctx: Ctx, files: [number, number, string][] | 'reading' | undefined, side: Side = 'right') {
  const { Box, Text } = ctx
  if (!files || files === 'reading') return [<Text key="reading" dimColor>{'Reading its files…'}</Text>]
  if (!files.length) return [<Text key="none" dimColor>{'No files changed.'}</Text>]
  const shown = [...files].sort((a, b) => b[0] + b[1] - (a[0] + a[1])).slice(0, 6)
  const total = files.reduce((n, [a, d]) => n + a + d, 0)
  return [
    ...shown.map(([a, d, path]) => (
      <Box key={`f:${path}`} flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-start">{path}</Text>
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {a > 0 && <Text color="success">{`+${a}`}</Text>}
          {d > 0 && <Text color="error">{`−${d}`}</Text>}
        </Box>
        {sideCard(ctx, side, [pathPieces(path), [...plusMinus(a, d), SEP, `${total ? Math.round(((a + d) * 100) / total) : 0}%`, { t: ` of the commit's ${total} lines`, s: 'd' }], `${plural(files.length, 'file')} in the commit`])}
      </Box>
    )),
    files.length > shown.length ? (
      <Text key="more" dimColor>
        {`+${files.length - shown.length} more files`}
      </Text>
    ) : null,
  ]
}

// An opened row's body, in a tinted box.
function opened(ctx: Ctx, key: string, children: any[], marginLeft = 0, thread?: any) {
  const { Box } = ctx
  return (
    <Box key={`open:${key}`} flexDirection="row" marginLeft={marginLeft}>
      {thread}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} backgroundColor={ctx.term ? undefined : '#ffffff08'} paddingX={0.75} paddingY={ctx.term ? 0 : 0.3} marginY={ctx.term ? 0 : 0.25} marginRight={0.5}>
        {children}
      </Box>
    </Box>
  )
}

// Commits, one a row; each row's card on `side` (none under the chips, where
// it would open over their buttons). From level 3, the first 15 and a line
// saying how many are hidden.
function commitList(ctx: Ctx, list: readonly Commit[], side: Side = 'right') {
  const { Box, Text } = ctx
  const width = Math.max(20, Math.min(48, (ctx.columns || 80) - 14)) - 2
  const shown = ctx.level >= 3 ? list.slice(0, CAP) : list
  const hidden = list.length - shown.length
  const rows = shown.map(c => (
    <Box key={`cl:${c.id}`} flexDirection="row" columnGap={1}>
      <Text dimColor>{c.id.slice(0, 7)}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{shortSubject(c.subject).lead ? `${shortSubject(c.subject).lead} · ${shortSubject(c.subject).rest}` : c.subject}</Text>
      </Box>
      <Text dimColor>{clock(c.at, ctx.now)}</Text>
      {sideCard(ctx, side, [[{ t: c.subject.slice(0, width), s: 'i' }], c.subject.length > width && [{ t: c.subject.slice(width, 2 * width), s: 'i' }], c.subject.length > 2 * width && [{ t: c.subject.slice(2 * width, 3 * width), s: 'i' }], [{ t: 'By ', s: 'd' }, c.author, SEP, c.parents.length > 1 ? { t: `a merge of ${c.parents.length}`, s: 'd' } : { t: c.id.slice(0, 12), s: 'b' }]])}
    </Box>
  ))
  if (hidden > 0)
    rows.push(
      <Text key="cl-hidden" dimColor>
        {`⋮ ${plural(hidden, 'more commit')} hidden: the pane is too full to draw them`}
      </Text>,
    )
  return rows
}

const draftCount = (rows: readonly Row[]) => rows.filter(r => !r.isCommitted).length

// The changes not committed yet, for a card: the press first (`verb` the
// files), then the counts and the turns that made them.
function draftFacts(ctx: Ctx, verb: string): CardLine[] {
  const rows = ctx.rows.filter(r => !r.isCommitted)
  const sum = (k: 'added' | 'deleted') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  const staged = rows.filter(r => r.status[0] !== ' ' && r.status[0] !== '?').length
  const untracked = rows.filter(r => r.status === '??').length
  const turns = [...new Set(rows.flatMap(r => (r.touch ? [r.touch.turn] : [])))].sort((a, b) => a - b)
  return [
    `${verb} the ${plural(rows.length, 'changed file')}`,
    [...plusMinus(sum('added'), sum('deleted')), SEP, `${staged} staged`, SEP, `${untracked} untracked`],
    turns.length ? [{ t: `Changed in turn${turns.length > 1 ? 's' : ''} `, s: 'd' }, turns.join(', ')] : 'No edit by Claude recorded for them',
    [{ t: 'Not in a commit yet: discarding them loses them', s: 'warn' }],
  ]
}

// --- Me · You vs main ------------------------------------------------------

function tracks(ctx: Ctx, hr: HistoryReading) {
  const { Box, Text, Button, Svg } = ctx
  const files = draftCount(ctx.rows)
  const base = hr.base ?? 'main'
  const baseName = base.replace(/^origin\//, '')
  const fork = hr.commits.find(c => c.id === hr.fork)
  const onBase = hr.branch === baseName || hr.branch === hr.base
  let figure: any
  if (ctx.graphic) {
    const dots = Math.min(3, hr.behind)
    const mine = Math.min(3, hr.ahead)
    let body = `<text x="22" y="10" font-size="10" font-family="Segoe UI, system-ui, sans-serif" fill="${MAIN}" text-anchor="middle">${esc(baseName)}</text><text x="84" y="10" font-size="10" font-family="Segoe UI, system-ui, sans-serif" fill="${YOU}" text-anchor="middle">you</text>`
    body += `<path d="M22 128 L22 ${dots ? 24 : 110}" stroke="${MAIN}" stroke-width="3" fill="none"/>`
    body += `<path d="M22 128 Q84 128 84 100 L84 ${files ? 32 : 60}" stroke="${YOU}" stroke-width="3" fill="none"${hr.ahead ? '' : ' stroke-dasharray="5 4"'}/>`
    for (let i = 0; i < dots; i++) body += `<circle cx="22" cy="${96 - i * 22}" r="${i === dots - 1 ? 5.5 : 4.5}" fill="${MAIN}"/>`
    if (hr.behind) body += `<text x="33" y="${100 - Math.max(0, dots - 1) * 11}" font-size="10" font-family="Segoe UI, system-ui, sans-serif" fill="${DIM}">+${hr.behind}</text>`
    for (let i = 0; i < mine; i++) body += `<circle cx="84" cy="${92 - i * 18}" r="4.5" fill="${YOU}"/>`
    body += `<circle cx="22" cy="128" r="6.5" fill="${BG}" stroke="${MAIN}" stroke-width="3"/>`
    if (files) body += `<circle cx="84" cy="32" r="6" fill="${BG}" stroke="${YOU}" stroke-width="2" stroke-dasharray="3 2"/><text x="76" y="36" font-size="10" font-family="Segoe UI, system-ui, sans-serif" fill="${YOU}" text-anchor="end">${plural(files, 'file')}</text>`
    figure = <Svg alt={`${baseName} is ${hr.behind} ahead of your fork point; you have ${hr.ahead} commits and ${files} changed files`} width={112} height={140} source={svgDoc(112, 140, body)} />
  } else {
    const m = (t: string) => <Text color={MAIN}>{t}</Text>
    const y = (t: string) => <Text color={YOU}>{t}</Text>
    figure = (
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          {m(baseName.padEnd(6))}
          {y('you')}
        </Text>
        {hr.behind > 0 && (
          <Text>
            {m(' ● ')}
            {'   '}
            {files ? y('◌') : ' '}
          </Text>
        )}
        <Text>
          {m(' │ ')}
          {'   '}
          {y('┊')}
        </Text>
        <Text>
          {m(' ◉')}
          {y('────╯')}
        </Text>
      </Box>
    )
  }
  const sentences = onBase
    ? [`You're on ${baseName}, with nothing it doesn't have.`]
    : [
        fork ? `You started from ${baseName} at “${joinSubject(fork.subject)}”, ${ago(ctx.now - fork.at)} ago.` : `Your branch and ${baseName} share no commit in the last ${hr.commits.length}.`,
        hr.behind ? `Since then ${baseName} got ${plural(hr.behind, 'commit')} you don't have.` : `${baseName} has nothing you don't have.`,
      ]
  const own = `You have ${hr.ahead ? plural(hr.ahead, 'commit') + ' of your own' : 'no commits yet'}, and ${files ? plural(files, 'changed file') : 'no changed files'}.`
  const chips: [string, string, string, any[]][] = [
    ['me:behind', `${hr.behind} behind ${baseName}`, `Behind: commits ${baseName} has that your branch doesn't.`, hr.behind ? commitList(ctx, hr.behindList, null) : [<Text key="n" dimColor>{`Nothing: you have everything ${baseName} has, as of the last fetch.`}</Text>]],
    ['me:ahead', `${hr.ahead} ahead`, `Ahead: commits on your branch that ${baseName} doesn't have yet.`, hr.ahead ? commitList(ctx, hr.commits.filter(c => mineOnly(hr, c.id)), null) : [<Text key="n" dimColor>{files ? `No commits yet. Your ${plural(files, 'changed file')} become one when you commit.` : 'No commits yet.'}</Text>]],
    ['me:push', hr.upstream ? (hr.unpushed ? `${plural(hr.unpushed, 'commit')} to push` : 'pushed') : 'not on GitHub yet', hr.upstream ? `Pushed: your commits are on ${hr.upstream}.` : 'Not pushed: this branch exists only on this computer. A push creates it on GitHub.', [<Text key="n" dimColor>{hr.upstream ? (hr.unpushed ? `${plural(hr.unpushed, 'commit')} here aren't on ${hr.upstream} yet.` : `Everything here is on ${hr.upstream}.`) : hr.ahead ? 'Push to put your commits on GitHub.' : 'Nothing to push yet: commit first.'}</Text>]],
  ]
  const out: any[] = [
    <Box key="tracks" flexDirection="row" columnGap={1.5} alignItems="center" paddingX={0.5}>
      {figure}
      <Box flexDirection="column" rowGap={ctx.term ? 0 : 0.5} flexShrink={1} minWidth={0}>
        {[...sentences, own].map((s, i) => (
          <Text key={`s${i}`} wrap="wrap">
            {s}
          </Text>
        ))}
      </Box>
    </Box>,
    <Box key="chips" flexDirection="row" columnGap={0.75} rowGap={0.25} flexWrap="wrap" paddingX={0.5} marginTop={ctx.term ? 0 : 0.5}>
      {chips.map(([key, label, explain], i) => (
        <Box key={`chip:${key}`} flexDirection="row" alignItems="center" columnGap={0.25}>
          {i === 0 && hr.behind > 0 && <Text color="warning">●</Text>}
          <Button key={key} dimColor={i === 2 && !hr.upstream} label={label} onPress={() => ctx.on.toggle(key)} />
          {card(ctx, key, 0, [cardLine(Text, explain, 0, 'wrap'), cardLine(Text, "Click to see what's in it.", 1, 'truncate-end')], 1, 'action')}
        </Box>
      ))}
    </Box>,
  ]
  for (const [key, , , body] of chips) if (ctx.open.has(key)) out.push(opened(ctx, key, body, 0.5))
  return <Box flexDirection="column">{out}</Box>
}

const joinSubject = (subject: string) => {
  const s = shortSubject(subject)
  return s.lead ? `${s.lead} · ${s.rest}` : subject
}
// A commit on HEAD's side only: on your branch, not on the base.
function mineOnly(hr: HistoryReading, id: string) {
  const by = new Map(hr.commits.map(c => [c.id, c]))
  let at = hr.head ?? undefined
  for (let i = 0; at && i < hr.ahead; i++) {
    if (at === id) return true
    at = by.get(at)?.parents[0]
  }
  return false
}

// --- Me · Where's my work --------------------------------------------------

function places(ctx: Ctx, hr: HistoryReading) {
  const { Box, Text, Button } = ctx
  const files = draftCount(ctx.rows)
  const staged = ctx.rows.filter(r => !r.isCommitted && r.status[0] !== ' ' && r.status[0] !== '?').length
  const baseName = (hr.base ?? 'main').replace(/^origin\//, '')
  const place = (key: string, name: string, count: any, small: string, explain: string, body: any[], isNow = false) => [
    <Box key={`place:${key}`} flexDirection="column" borderStyle="round" borderColor={isNow ? '#e0af6888' : RULE} paddingX={0.75} marginX={0.5}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Box marginLeft={ctx.graphic ? -0.75 : 0} flexShrink={1}>
          <Button key={key} plain label={name} onPress={() => ctx.on.toggle(key)} />
        </Box>
        {count}
      </Box>
      <Text dimColor wrap="wrap">
        {small}
      </Text>
      {card(ctx, key, 2, cardLines(Text, [explain], 1, 'wrap'), 3, 'action')}
    </Box>,
    ctx.open.has(key) ? opened(ctx, key, body, 0.5) : null,
  ]
  const arrow = (key: string, word: string, text: string, explain: string) => (
    <Box key={`arrow:${key}`} flexDirection="row" columnGap={1} paddingX={1.5}>
      <Text dimColor>↓</Text>
      <Text dimColor wrap="truncate-end">
        <Text bold>{word}</Text>
        {`: ${text}`}
      </Text>
      {card(ctx, `arrow:${key}`, 4, cardLines(Text, [explain], 1, 'wrap'))}
    </Box>
  )
  const draftRows = ctx.rows.filter(r => !r.isCommitted)
  return (
    <Box flexDirection="column">
      {place(
        'pl:files',
        'Files on this computer',
        <Text color={files ? 'warning' : DIM}>{files ? `${files} changed` : 'clean'}</Text>,
        `${files ? 'Not saved in git yet' : 'Nothing changed since the last commit'} · ${staged} staged.`,
        'Working tree: the files on disk. Changes here are lost if you discard them, until you commit.',
        draftRows.length
          ? draftRows.slice(0, 8).map(r => (
              <Box key={`d:${r.path}`} flexDirection="row" columnGap={1}>
                <Text color={statusColor(r.status)}>{statusLetter(r.status)}</Text>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text wrap="truncate-start">{r.path}</Text>
                </Box>
                {r.added ? <Text color="success">{`+${r.added}`}</Text> : null}
                {r.deleted ? <Text color="error">{`−${r.deleted}`}</Text> : null}
                {sideCard(ctx, 'right', fileFacts(r, ctx.now))}
              </Box>
            ))
          : [<Text key="n" dimColor>{'Nothing changed.'}</Text>],
        true,
      )}
      {arrow('commit', 'commit', 'save them as a snapshot on your branch', 'Commit: saves the staged changes as a snapshot with a message (git add, then git commit).')}
      {place('pl:branch', 'Your branch, here', <Text dimColor>{plural(hr.ahead, 'commit')}</Text>, `${hr.branch}${hr.fork ? `, from ${baseName} at ${hr.fork.slice(0, 7)}` : ''}.`, 'Local branch: your line of commits on this computer.', hr.ahead ? commitList(ctx, hr.commits.filter(c => mineOnly(hr, c.id))) : [<Text key="n" dimColor>{'No commits on this branch yet.'}</Text>])}
      {arrow('push', 'push', 'send your commits to GitHub', 'Push: copies your new commits to GitHub, where others and a pull request can see them.')}
      {place(
        'pl:remote',
        'Your branch on GitHub',
        <Text dimColor>{hr.upstream ? (hr.unpushed ? `${hr.unpushed} to push` : 'up to date') : 'not there yet'}</Text>,
        hr.upstream ? `${hr.upstream}, as of the last fetch.` : 'Nothing pushed. Nobody else can see this branch.',
        "origin: the copy on GitHub. origin/<your branch> appears after the first push.",
        [<Text key="n" dimColor>{hr.upstream ? `Tracks ${hr.upstream}.` : 'This branch has never been pushed.'}</Text>],
      )}
      {arrow('pr', 'pull request', `ask to merge into ${baseName}`, `Pull request: a request on GitHub to merge your branch into ${baseName}, where it can be reviewed.`)}
      {place('pl:main', `${baseName} on GitHub`, <Text color={hr.behind ? 'warning' : DIM}>{hr.behind ? `${hr.behind} newer` : 'nothing newer'}</Text>, hr.behind ? `${plural(hr.behind, 'commit')} landed after you started. As of the last fetch.` : 'Nothing landed after you started, as of the last fetch.', `${baseName}: the shared line. “Newer” counts its commits since your fork point.`, hr.behind ? commitList(ctx, hr.behindList) : [<Text key="n" dimColor>{'Nothing newer.'}</Text>])}
    </Box>
  )
}

// --- All · Lanes -----------------------------------------------------------

type Drawn = { list: Commit[]; graph: Graph; work: Map<string, Work>; color: (id: string) => string; width: number; paths: { d: string; color: string; y1: number; y2: number; dashed: boolean }[]; dots: string[] }

const DRAFT = 'draft'

function drawn(hr: HistoryReading, files: number): Drawn {
  const list: Commit[] = files && hr.head ? [{ id: DRAFT, parents: [hr.head], refs: [], at: 0, author: '', subject: '' }, ...hr.commits] : hr.commits
  const graph = layout(list)
  const work = workOf(hr.commits, hr.head, hr.main)
  const color = (id: string) => (id === DRAFT ? YOU : colorOf(work.get(id)))
  const n = list.length
  const y = (row: number) => row * H + H / 2
  const paths: Drawn['paths'] = []
  for (const l of graph.lines) {
    const beyond = l.to >= n
    const x1 = lx(l.fromLane)
    const xv = lx(l.via)
    const x2 = lx(l.toLane)
    const y1 = y(l.from)
    const y2 = beyond ? (n + 1) * H : y(l.to)
    let d: string
    if (!beyond && l.to === l.from + 1 && (x1 !== xv || xv !== x2)) d = `M${x1} ${y1}C${x1} ${y1 + H * 0.6} ${x2} ${y1 + H * 0.4} ${x2} ${y2}`
    else {
      d = `M${x1} ${y1}`
      if (x1 !== xv) d += `C${x1} ${y1 + H * 0.6} ${xv} ${y1 + H * 0.4} ${xv} ${y1 + H}`
      if (!beyond && xv !== x2) d += `L${xv} ${y2 - H}C${xv} ${y2 - H * 0.4} ${x2} ${y2 - H * 0.6} ${x2} ${y2}`
      else d += `L${xv} ${y2}`
    }
    const lineColor = l.isMerge ? (beyond ? '#9c9a94' : color(l.parent)) : color(list[l.from]?.id ?? '')
    paths.push({ d, color: lineColor, y1, y2, dashed: list[l.from]?.id === DRAFT })
  }
  const dots = graph.placed.map(p => {
    const c = list[p.row]
    const cx = lx(p.lane)
    const cy = y(p.row)
    const col = color(p.id)
    if (p.id === DRAFT) return `<circle cx="${cx}" cy="${cy}" r="5" fill="${BG}" stroke="${col}" stroke-width="2" stroke-dasharray="3 2"/>`
    const ring = p.id === hr.head ? `<circle cx="${cx}" cy="${cy}" r="8" fill="${BG}" stroke="${YOU}" stroke-width="2"/>` : ''
    return `${ring}<circle cx="${cx}" cy="${cy}" r="${(c?.parents.length ?? 0) > 1 ? 3.8 : 4.6}" fill="${col}" stroke="${BG}" stroke-width="1.5"/>`
  })
  return { list, graph, work, color, width: 10 + graph.lanes * LW, paths, dots }
}

// Row `row`'s slice of the graph: the paths and dots inside its band.
function slice(g: Drawn, row: number) {
  const top = row * H
  const body =
    g.paths
      .filter(p => p.y2 >= top && p.y1 <= top + H)
      .map(p => `<path d="${p.d}" stroke="${p.color}" stroke-width="2" fill="none"${p.dashed ? ' stroke-dasharray="4 3"' : ''}/>`)
      .join('') + (g.dots[row] ?? '')
  return svgDoc(g.width, H, body, `0 ${top} ${g.width} ${H}`)
}

// The lines that run on under row `row`, straight down, for an opened row.
function thread(g: Drawn, row: number) {
  let body = ''
  g.graph.lines.forEach((l, i) => {
    const at = crossing(l, row)
    if (at === null) return
    const x = 8 + at * LW
    body += `<path d="M${x} 0L${x} 900" stroke="${g.paths[i]?.color ?? DIM}" stroke-width="2"${g.paths[i]?.dashed ? ' stroke-dasharray="4 3"' : ''}/>`
  })
  return svgDoc(g.width, 900, body)
}

function lanes(ctx: Ctx, hr: HistoryReading, fellBack: boolean) {
  const { Box, Text, Button, Svg } = ctx
  const files = draftCount(ctx.rows)
  if (!hr.commits.length) return <Text dimColor>No commits yet.</Text>
  const g = drawn(hr, files)
  const colCells = Math.ceil((g.width / CELL) * 10) / 10 + 0.3
  const out: any[] = []
  if (fellBack)
    out.push(
      <Box key="fellback" paddingX={0.5}>
        <Text dimColor>The terminal draws no images, so Subway shows as Lanes here.</Text>
      </Box>,
    )
  const art = ctx.graphic ? null : textArt(g, hr, Text)
  // From level 3, the first 15 rows; the line under them says how many are hidden.
  const count = ctx.level >= 3 ? Math.min(g.list.length, CAP) : g.list.length
  const hidden = g.list.length - count
  g.list.slice(0, count).forEach((c, row) => {
    const key = c.id === DRAFT ? DRAFT : `c:${c.id}`
    const w = c.id === DRAFT ? { key: 'you', name: 'your branch' } : g.work.get(c.id)
    const scope = `br:${w?.key ?? c.id}`.slice(0, 64)
    const s = shortSubject(c.subject)
    const refs = c.refs.map(r => r.replace(/^HEAD -> /, '')).filter(r => r !== 'HEAD' && !r.endsWith('/HEAD'))
    const tags: any[] = []
    const isMain = refs.includes((hr.base ?? '').replace(/^origin\//, ''))
    const isOrigin = !!hr.base && refs.includes(hr.base)
    if (isMain) tags.push(light(ctx, 'main', (hr.base ?? '').replace(/^origin\//, ''), 'ref'))
    if (isOrigin) tags.push(light(ctx, 'origin', hr.base ?? '', 'cloud'))
    if (c.id === hr.head) tags.push(light(ctx, 'here', 'you are here', 'here'))
    // The tags' meaning goes in the row's card: a card of their own would open with it.
    const meant = [isOrigin ? `Tip of ${hr.base} at the last fetch` : isMain ? `Tip of ${(hr.base ?? '').replace(/^origin\//, '')}` : '', c.id === hr.head ? `You are here: HEAD, on ${hr.branch}` : ''].filter(Boolean).join(' · ')
    const others = refs.filter(r => r !== hr.base && r !== (hr.base ?? '').replace(/^origin\//, '') && r !== hr.branch && !r.startsWith('tag: ')).length
    const lead = c.id === DRAFT ? 'Your changes ·' : s.lead ? `${s.lead} ·` : ''
    const room = ctx.columns - colCells - lead.length - (c.id === hr.head ? 13 : 0) - (refs.length ? 14 : 0) - 9
    const label = cut(c.id === DRAFT ? `${plural(files, 'file')}, not committed` : s.rest, Math.max(8, Math.floor(room)))
    const graph = ctx.graphic ? (
      <Box key="g" width={colCells} flexShrink={0}>
        <Svg alt="graph" width={g.width} height={H} source={slice(g, row)} />
      </Box>
    ) : (
      <Box key="g" flexShrink={0}>
        <Text>{art?.[row]}</Text>
      </Box>
    )
    out.push(
      <Box key={`row:${c.id}`} flexDirection="row" alignItems="center" columnGap={0.75} paddingRight={0.5} hover={{ scope, backgroundColor: LIT }}>
        {graph}
        {lead && (
          <Box flexShrink={0}>
            <Text bold={c.id !== DRAFT} italic={c.id === DRAFT} color={c.id === DRAFT ? YOU : undefined}>
              {lead}
            </Text>
          </Box>
        )}
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" marginLeft={ctx.graphic ? -0.75 : 0}>
          <Box>
            <Button key={key} plain label={label} onPress={() => ctx.on.toggle(key, c.id === DRAFT ? undefined : c.id)} />
          </Box>
        </Box>
        <Box flexDirection="row" columnGap={0.5} flexShrink={0} alignItems="center">
          {tags}
          <Text dimColor>{c.id === DRAFT ? 'now' : clock(c.at, ctx.now)}</Text>
        </Box>
        {c.id === DRAFT
          ? card(ctx, key, colCells + 1, cardLines(Text, ['Not committed yet', `${plural(files, 'file')} changed since HEAD. Click to see them.`]), 1, 'action')
          : card(ctx, key, colCells + 1, commitCard(ctx, c, w, meant || undefined), 1, 'action')}
      </Box>,
    )
    if (ctx.open.has(key)) {
      const body = c.id === DRAFT ? draftFiles(ctx) : fileLines(ctx, ctx.files.get(c.id))
      const line = ctx.graphic ? (
        <Box key="thread" width={colCells} flexShrink={0} overflow="hidden">
          <Box position="absolute" top={0} left={0}>
            <Svg alt="graph" width={g.width} height={900} source={thread(g, row)} />
          </Box>
        </Box>
      ) : (
        <Box key="thread" flexShrink={0}>
          <Text>{art?.threads[row]}</Text>
        </Box>
      )
      const full = c.id === DRAFT ? [] : [<Text key="msg" wrap="wrap">{c.subject}</Text>]
      out.push(opened(ctx, key, [...full, ...body], 0, line))
    }
  })
  const oldest = hr.commits[hr.commits.length - 1]
  const older = (
    <Box key="older" flexDirection="row" alignItems="center" columnGap={0.75}>
      {ctx.graphic ? (
        <Box width={colCells} flexShrink={0}>
          <Svg alt="graph" width={g.width} height={H} source={slice(g, count)} />
        </Box>
      ) : (
        <Text>{art?.[count]}</Text>
      )}
      <Text dimColor>{hidden ? `⋮ ${plural(hidden, 'more commit')} hidden: the pane is too full to draw them` : `⋮ older than ${clock(hr.commits[hr.commits.length - 1]?.at ?? 0, ctx.now)}`}</Text>
      {card(
        ctx,
        'older',
        colCells + 1,
        cardLines(Text, [
          hidden ? `The newest ${plural(count, 'commit')} of ${hr.commits.length} read are drawn: the desktop stops drawing a pane past about 2,000 elements` : `The newest ${plural(hr.commits.length, 'commit')} are drawn, of every branch`,
          oldest && [{ t: 'Oldest drawn: ', s: 'd' }, { t: oldest.id.slice(0, 7), s: 'b' }, SEP, { t: oldest.subject, s: 'i' }],
          oldest && [{ t: 'By ', s: 'd' }, oldest.author, SEP, { t: clock(oldest.at, ctx.now), s: 'd' }],
          'The historyDepth option sets how many',
        ]),
      )}
    </Box>
  )
  out.push(older)
  return <Box flexDirection="column">{out}</Box>
}

// The changed files not committed yet; each row's card (the T pill's turn
// included) on `side`.
function draftFiles(ctx: Ctx, side: Side = 'right') {
  const { Box, Text } = ctx
  return ctx.rows
    .filter(r => !r.isCommitted)
    .slice(0, 10)
    .map(r => (
      <Box key={`df:${r.path}`} flexDirection="row" columnGap={1}>
        <Text color={statusColor(r.status)}>{statusLetter(r.status)}</Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-start">{r.path}</Text>
        </Box>
        {r.touch && light(ctx, 'turn', `T${r.touch.turn}`, 'claude')}
        {r.added ? <Text color="success">{`+${r.added}`}</Text> : null}
        {r.deleted ? <Text color="error">{`−${r.deleted}`}</Text> : null}
        {sideCard(ctx, side, fileFacts(r, ctx.now))}
      </Box>
    ))
}

// The terminal's lanes: two cells a lane, `●` a commit (◌ the draft, ◉ HEAD),
// `│` a line passing, `╮` a line leaving to the right, `╯` one coming back.
function textArt(g: Drawn, hr: HistoryReading, Text: any) {
  const n = g.list.length
  const cols = g.graph.lanes * 2
  const rows: { ch: string; color: string }[][] = Array.from({ length: n + 1 }, () => Array.from({ length: cols }, () => ({ ch: ' ', color: DIM })))
  const set = (r: number, c: number, ch: string, color: string) => {
    const cell = rows[r]?.[c]
    if (!cell) return
    if (cell.ch === '│' && (ch === '─' || ch === '╮' || ch === '╯')) ch = ch === '─' ? '┼' : ch
    cell.ch = ch
    cell.color = color
  }
  g.graph.lines.forEach((l: Line, i) => {
    const color = g.paths[i]?.color ?? DIM
    const end = Math.min(l.to, n)
    for (let r = l.from + 1; r < end; r++) set(r, l.via * 2, '│', color)
    if (l.to >= n) set(n, l.via * 2, '│', color)
    if (l.fromLane !== l.via) {
      const [a, b] = l.fromLane < l.via ? [l.fromLane, l.via] : [l.via, l.fromLane]
      for (let c = a * 2 + 1; c < b * 2; c++) set(l.from, c, '─', color)
      set(l.from, l.via * 2, l.via > l.fromLane ? '╮' : '╭', color)
    }
    if (l.to < n && l.via !== l.toLane) {
      const [a, b] = l.toLane < l.via ? [l.toLane, l.via] : [l.via, l.toLane]
      for (let c = a * 2 + 1; c < b * 2; c++) set(l.to, c, '─', color)
      set(l.to, l.via * 2, l.via > l.toLane ? '╯' : '╰', color)
    }
  })
  g.graph.placed.forEach(p => set(p.row, p.lane * 2, p.id === DRAFT ? '◌' : p.id === hr.head ? '◉' : '●', g.color(p.id)))
  const toText = (cells: { ch: string; color: string }[]) =>
    cells.map((c, i) =>
      c.ch === ' ' ? (
        ' '
      ) : (
        <Text key={i} color={c.color}>
          {c.ch}
        </Text>
      ),
    )
  const out: any = rows.map(r => toText(r))
  // Under an opened row: the lines that run on, as `│`.
  out.threads = rows.map((_, r) => {
    const cells = Array.from({ length: cols }, () => ({ ch: ' ', color: DIM }))
    g.graph.lines.forEach((l, i) => {
      const at = crossing(l, r)
      if (at !== null && Number.isInteger(at)) cells[at * 2] = { ch: '│', color: g.paths[i]?.color ?? DIM }
    })
    return toText(cells)
  })
  return out
}

// --- All · Subway ----------------------------------------------------------

function subwayView(ctx: Ctx, hr: HistoryReading) {
  const { Box, Text, Button, Svg } = ctx
  const files = draftCount(ctx.rows)
  const map = subway(hr.commits, hr.main, hr.head, hr.fork, files, Math.max(390, Math.min(900, Math.round(ctx.columns * CELL) - 24)))
  if (!map) return <Text dimColor>No merges on main to draw.</Text>
  const font = 'font-family="Segoe UI, system-ui, sans-serif" font-size="9.5"'
  let body = `<g ${font}>`
  const my = map.mainY
  for (const l of map.loops) {
    if (l.isYou) body += `<path d="M${l.x1} ${my} Q${l.x1} ${l.y} ${l.x1 + 22} ${l.y} L${l.x2} ${l.y}" stroke="${l.color}" stroke-width="4" fill="none" stroke-dasharray="7 5"/>`
    else body += `<path d="M${l.x1} ${my} Q${l.x1} ${l.y} ${l.x1 + 20} ${l.y} L${l.x2 - 20} ${l.y} Q${l.x2} ${l.y} ${l.x2} ${my}" stroke="${l.color}" stroke-width="4" fill="none"/>`
  }
  for (const t of map.ties) body += `<path d="M${t.x1} ${my} L${t.x2} ${t.y}" stroke="${t.color}" stroke-width="1.5" stroke-dasharray="2 3" fill="none"/>`
  const last = map.stations[map.stations.length - 1]?.x ?? map.width - 60
  body += `<path d="M14 ${my} L${last + 20} ${my}" stroke="${MAIN}" stroke-width="5"/>`
  for (const l of map.loops) for (const s of l.stops) body += `<circle cx="${s.x}" cy="${l.y}" r="3.5" fill="${BG}" stroke="${l.color}" stroke-width="2.5"/>`
  for (const s of map.stations) body += `<circle cx="${s.x}" cy="${my}" r="6.5" fill="${FG}" stroke="${MAIN}" stroke-width="3"/>`
  const fork = map.stations.find(s => s.isFork)
  if (fork) body += `<circle cx="${fork.x}" cy="${my}" r="10.5" fill="none" stroke="${YOU}" stroke-width="2"/>`
  if (map.draft) body += `<circle cx="${map.draft.x}" cy="${map.draft.y}" r="7" fill="${BG}" stroke="${YOU}" stroke-width="2.5" stroke-dasharray="3 2"/><text x="${map.draft.x}" y="${map.draft.y + 22}" fill="${YOU}" text-anchor="middle">${plural(map.draft.files, 'file')}</text>`
  for (const s of map.stations) {
    // Under main, clear of the loops: left of a station a loop leaves from below, else right.
    const leaves = map.loops.some(l => l.y > my && l.x1 === s.x)
    if (!s.isFork) body += `<text x="${leaves ? s.x - 9 : s.x + 9}" y="${my + 20}" fill="${FG}" font-weight="600" text-anchor="${leaves ? "end" : "start"}">${esc(s.label)}</text>`
    body += `<text x="${s.x}" y="16" fill="${DIM}" text-anchor="middle">${esc(clock(s.at, ctx.now))}</text>`
  }
  if (fork) body += `<text x="${fork.x}" y="${map.height - 8}" fill="#f1c98c" font-weight="600" text-anchor="middle">${esc(fork.label)} · you started here</text>`
  body += `<text x="${last + 24}" y="${my + 4}" fill="#a9c1fb" font-weight="600">${esc((hr.base ?? 'main').replace(/^origin\//, ''))}</text>`
  for (const l of map.loops) if (!l.isYou) body += `<text x="${l.x1 + 20}" y="${l.y < my ? l.y - 6 : l.y + 15}" fill="${DIM}">${esc(l.name.length > 22 ? `${l.name.slice(0, 21)}…` : l.name)}</text>`
  body += `<path d="M14 22 L${map.width - 14} 22" stroke="${RULE}"/></g>`
  const out: any[] = [
    <Box key="map" paddingX={0.5}>
      <Svg alt={`Subway map: ${map.stations.length} merges on main, ${map.loops.length} lines of work`} source={svgDoc(map.width, map.height, body)} />
    </Box>,
    <Box key="stops-h" paddingX={0.5} marginTop={0.5}>
      <Text dimColor>STOPS</Text>
    </Box>,
  ]
  const by = new Map(hr.commits.map(c => [c.id, c]))
  const onMain = new Set(mainLine(hr.commits, hr.main).map(c => c.id))
  const work = workOf(hr.commits, hr.head, hr.main)
  // At level 4 the stops fold under one line: the map above still shows them.
  if (ctx.level >= 4) {
    const stops = map.stations.length + (files ? 1 : 0)
    out.push(
      <Box key="stops-folded" paddingX={0.5}>
        <Text dimColor wrap="wrap">{`${plural(stops, 'stop')} folded: the pane is too full to list them. Pick Lanes to open a commit.`}</Text>
      </Box>,
    )
    return <Box flexDirection="column">{out}</Box>
  }
  if (files) out.push(stopRow(ctx, DRAFT, YOU, '◌', 'Your changes', plural(files, 'file'), null, undefined))
  for (const s of [...map.stations].reverse()) {
    const c = by.get(s.id)
    if (!c) continue
    const pr = prOf(c.subject)
    const taken = c.parents.length > 1 ? takenIn(hr.commits, c, onMain) : null
    const w = taken?.all[0] ? work.get(taken.all[0].id) : work.get(c.id)
    const label = `Stop ${pr ? `#${pr.pr} · ${pr.name}` : `${c.id.slice(0, 7)} · ${c.subject}`}${s.isFork ? ' · you started here' : ''}`
    out.push(stopRow(ctx, `c:${c.id}`, colorOf(w), '●', label, taken ? plural(taken.commits.length, 'commit') : '1 commit', c, w))
  }
  return <Box flexDirection="column">{out}</Box>
}

function stopRow(ctx: Ctx, key: string, color: string, glyph: string, label: string, count: string, c: Commit | null, w: Work | undefined) {
  const { Box, Text, Button } = ctx
  const rows: any[] = [
    <Box key={`stop:${key}`} flexDirection="row" alignItems="center" columnGap={0.75} paddingX={0.5} hover={{ scope: `br:${w?.key ?? key}`.slice(0, 64), backgroundColor: LIT }}>
      <Text color={color}>{glyph}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" marginLeft={ctx.graphic ? -0.75 : 0}>
        <Box>
          <Button key={`stop-${key}`} plain label={cut(label, Math.max(10, ctx.columns - 16))} onPress={() => ctx.on.toggle(key, c?.id)} />
        </Box>
      </Box>
      <Text dimColor>{count}</Text>
      {c ? card(ctx, `stop-${key}`, 3, commitCard(ctx, c, w), 1, 'action') : card(ctx, `stop-${key}`, 3, cardLines(Text, draftFacts(ctx, 'Press to list')), 1, 'action')}
    </Box>,
  ]
  if (ctx.open.has(key)) rows.push(opened(ctx, key, c ? [<Text key="msg" wrap="wrap">{c.subject}</Text>, ...fileLines(ctx, ctx.files.get(c.id))] : draftFiles(ctx), 2))
  return rows
}
