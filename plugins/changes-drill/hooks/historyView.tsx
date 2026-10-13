// The History section under the list of changed files: a header with when it
// last read and its own Refresh, then Current (what happened in sentences, or
// the changed files as a tree, by its picker), and a Branches button that
// opens branch-drill's pane, where Me (your branch against main, or where
// your work sits) and All (every branch as lanes or a subway map) moved.
// Pure drawing over what register.tsx read. On the desktop the tree is
// static SVG images, one per row so each row stays pressable; a hover card is
// a hidden Box its row reveals.

import type { Commit } from './history.ts'
import { YOU, clock, colorOf, fileTree, mainLine, prOf, shortBranch, shortSubject, takenIn, workOf } from './history.ts'
import { stageWord, statusColor, statusLetter, statusWord } from './git.ts'
import type { Row } from './register.tsx'

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The Changes pane
// draws at the richest level that fits: 0 every card, 1 action and status
// cards only, 2 no cards, 3 only the last turn open (the rest under the fold
// line), 4 the list cut to 30 rows (its "⋮ N more" line says the rest).
export const BUDGET = 1000
// Characters of the serialized tree, an inline SVG's source included.
export const CHAR_BUDGET = 200_000
export const TOP = 4
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
// The level being drawn: the card helpers (here and in pane.tsx) read it, set
// before each draw.
let level = 0
export function setLevel(n: number) {
  level = n
}
// Whether a card of this tone is drawn at the current level: from 1 the
// drill-down (info) cards go, from 2 every card.
export const keeps = (tone: Tone) => level < 1 || (level < 2 && tone !== 'info')

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

export type Picks = { cur: 'story' | 'files' }

export type HistoryViewArgs = {
  Box: any
  Text: any
  Button: any
  Svg?: any
  Select?: any
  Code?: any
  surface: string
  // The pane body's width in cells: the section is sized to it, and a
  // label that would not fit is cut, since a desktop Button does not shrink.
  columns: number
  history: HistoryReading | null | undefined
  isReading: boolean
  rows: readonly Row[]
  picks: Picks
  open: ReadonlySet<string>
  files: ReadonlyMap<string, [number, number, string][] | 'reading'>
  peeks: ReadonlyMap<string, readonly string[] | 'reading'>
  now: number
  on: {
    refresh: () => void
    pick: (section: keyof Picks, value: string) => void
    toggle: (key: string, commit?: string) => void
    peek: (path: string) => void
    // Opens branch-drill's Branches pane (Me and All).
    branches: () => void
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
const CELL = 7.9 // CSS pixels per cell, as measured on the desktop
const LIGHT = { claude: { fg: '#8db4f0', bg: '#1d3150' } }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const svgDoc = (w: number, hr: number, body: string, viewBox = `0 0 ${w} ${hr}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hr}" viewBox="${viewBox}">${body}</svg>`

type Ctx = HistoryViewArgs & { graphic: boolean; term: boolean; mobile: boolean }

export function historySection(args: HistoryViewArgs) {
  const { Box, Text, Button } = args
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
    <Box key="history-head" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={0.5} marginTop={1}>
      <Text bold>History</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {status}
        </Text>
        <Button key="history-refresh" plain dimColor label="↻ Refresh" onPress={() => args.on.refresh()} />
      </Box>
      {headTip}
    </Box>
  )
  if (hr === undefined)
    return (
      <Box key="history" flexDirection="column" width="100%" overflow="hidden">
        {head}
        <Box paddingX={0.5}>
          <Text dimColor>Reading the history…</Text>
        </Box>
        {branchesRow(ctx)}
      </Box>
    )
  if (hr === null)
    return (
      <Box key="history" flexDirection="column" width="100%" overflow="hidden">
        {head}
        <Box paddingX={0.5}>
          <Text dimColor>No history: not a git repository, or no commits yet.</Text>
        </Box>
      </Box>
    )
  return (
    <Box key="history" flexDirection="column" width="100%" overflow="hidden">
      {head}
      {section(ctx, 'cur', 'Current', "what's happening now", args.picks.cur === 'story' ? story(ctx, hr) : tree(ctx))}
      {branchesRow(ctx)}
    </Box>
  )
}

// The way to Me and All: a button opening branch-drill's Branches pane, and a
// card saying what is there.
function branchesRow(ctx: Ctx) {
  const { Box, Text, Button } = ctx
  const tip = hoverCard(
    Box,
    ctx.surface,
    { right: 0 },
    cardLines(Text, [
      "Opens the Branches pane, branch-drill's",
      [{ t: 'Me', s: 'b' }, { t: ': your branch against main, or where your work sits', s: 'd' }],
      [{ t: 'All', s: 'b' }, { t: ': every branch as lanes or a subway map', s: 'd' }],
      'Each with its picker; clicking a commit opens its files',
      [{ t: 'Needs branch-drill, from the motta-claude-mods marketplace', s: 'f' }],
    ]),
    'action',
  )
  return (
    <Box key="history-branches-row" flexDirection="column" marginTop={1}>
      {ctx.term ? <Text dimColor>{'─'.repeat(40)}</Text> : <Box width="100%" height={0.06} backgroundColor={RULE} />}
      <Box key="tip:branches" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={0.5} paddingY={ctx.term ? 0 : 0.4}>
        <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
          <Text bold>Me and All</Text>
          <Text dimColor wrap="truncate-end">
            your branch and every branch
          </Text>
        </Box>
        <Button key="history-branches" label="Branches ▸" onPress={() => ctx.on.branches()} />
        {tip}
      </Box>
    </Box>
  )
}

const OPTIONS: Record<keyof Picks, [string, string][]> = {
  cur: [
    ['story', 'Story'],
    ['files', 'Files tree'],
  ],
}

// What each pick draws, for the picker's card.
const PICKED: Record<string, string> = {
  story: 'what happened lately, in sentences',
  files: 'the changed files as a tree',
}

function section(ctx: Ctx, id: keyof Picks, name: string, sub: string, body: any) {
  const { Box, Text, Button, Select } = ctx
  const options = OPTIONS[id]
  // The picker's card opens 3 cells in from the right, clear of a ▸ above it.
  const picker =
    Select && !ctx.mobile ? (
      <Box key={`tip:pick-${id}`} flexShrink={0}>
        <Select key={`history-pick-${id}`} value={ctx.picks[id]} options={options.map(([value, label]) => ({ value, label }))} onSelect={(v: string) => ctx.on.pick(id, v)} />
        {hoverCard(ctx.Box, ctx.surface, { right: 3 }, cardLines(ctx.Text, [`Switches ${name} between ${options.map(([, label]) => label).join(' and ')}`, ...options.map(([value, label]): CardLine => [label, { t: `: ${PICKED[value] ?? ''}`, s: 'd' }])]), 'action')}
      </Box>
    ) : (
      <Box flexDirection="row" columnGap={0.5}>
        {options.map(([value, label]) => (
          <Button key={`history-pick-${id}-${value}`} dimColor={ctx.picks[id] !== value} label={label} onPress={() => ctx.on.pick(id, value)} />
        ))}
      </Box>
    )
  return (
    <Box key={`history-${id}`} flexDirection="column" marginTop={1}>
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
// it would open over their buttons).
function commitList(ctx: Ctx, list: readonly Commit[], side: Side = 'right') {
  const { Box, Text } = ctx
  const width = Math.max(20, Math.min(48, (ctx.columns || 80) - 14)) - 2
  return list.map(c => (
    <Box key={`cl:${c.id}`} flexDirection="row" columnGap={1}>
      <Text dimColor>{c.id.slice(0, 7)}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{shortSubject(c.subject).lead ? `${shortSubject(c.subject).lead} · ${shortSubject(c.subject).rest}` : c.subject}</Text>
      </Box>
      <Text dimColor>{clock(c.at, ctx.now)}</Text>
      {sideCard(ctx, side, [[{ t: c.subject.slice(0, width), s: 'i' }], c.subject.length > width && [{ t: c.subject.slice(width, 2 * width), s: 'i' }], c.subject.length > 2 * width && [{ t: c.subject.slice(2 * width, 3 * width), s: 'i' }], [{ t: 'By ', s: 'd' }, c.author, SEP, c.parents.length > 1 ? { t: `a merge of ${c.parents.length}`, s: 'd' } : { t: c.id.slice(0, 12), s: 'b' }]])}
    </Box>
  ))
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

// --- Current · Story -------------------------------------------------------

function story(ctx: Ctx, hr: HistoryReading) {
  const { Box, Text, Button } = ctx
  const files = draftCount(ctx.rows)
  const baseName = (hr.base ?? 'main').replace(/^origin\//, '')
  const line = mainLine(hr.commits, hr.main)
  const onMain = new Set(line.map(c => c.id))
  const work = workOf(hr.commits, hr.head, hr.main)
  // A commit item's card: what ▸ opens, then which commit and its full subject.
  const storyTip = (c: Commit, commits?: number): CardLine[] => [commits ? `▸ lists its ${plural(commits, 'commit')}` : '▸ lists its files', [{ t: c.id.slice(0, 7), s: 'b' }, SEP, { t: 'by ', s: 'd' }, c.author, ...(c.parents.length > 1 ? [SEP, { t: 'a merge', s: 'd' } as Piece] : [])], [{ t: c.subject, s: 'i' }]]
  type Item = { key: string; color: string; hollow?: boolean; ring?: boolean; when: string; what: any; small: string; body: () => any[]; commit?: string; tip: CardLine[] }
  const items: Item[] = []
  if (files) {
    const turns = [...new Set(ctx.rows.filter(r => !r.isCommitted && r.touch).map(r => r.touch?.turn ?? 0))].sort((a, b) => a - b)
    items.push({ key: 'st:now', color: YOU, hollow: true, when: 'now', what: [`You have `, <Text key="b" bold>{plural(files, 'changed file')}</Text>, ` that aren't in a commit yet.`], small: turns.length ? `Claude changed them in turn${turns.length > 1 ? 's' : ''} ${turns.join(', ')}.` : 'Changed outside a turn of this session.', body: () => draftFiles(ctx, 'left'), tip: draftFacts(ctx, '▸ lists').slice(0, 3) })
  }
  const behind = new Set(hr.behindList.map(c => c.id))
  for (const c of line.filter(c => behind.has(c.id)).slice(0, 4)) {
    const pr = prOf(c.subject)
    const taken = c.parents.length > 1 ? takenIn(hr.commits, c, onMain) : null
    items.push({ key: `st:${c.id}`, commit: c.id, color: colorOf(taken?.all[0] ? work.get(taken.all[0].id) : work.get(c.id)), when: clock(c.at, ctx.now), what: pr ? [`${baseName} moved ahead: `, <Text key="b" bold>{`PR #${pr.pr}`}</Text>, ` ${pr.name} was merged.`] : [`${baseName} moved ahead: “${c.subject}”.`], small: taken ? `${plural(taken.commits.length, 'commit')} your branch doesn't have yet.` : "A commit your branch doesn't have yet.", body: () => (taken ? commitList(ctx, taken.commits, 'left') : fileLines(ctx, ctx.files.get(c.id), 'left')), tip: storyTip(c, taken?.commits.length) })
  }
  const by = new Map(hr.commits.map(c => [c.id, c]))
  const mine = hr.commits.filter(c => mineOnly(hr, c.id)).slice(0, 3)
  for (const c of mine) items.push({ key: `st:${c.id}`, commit: c.id, color: YOU, when: clock(c.at, ctx.now), what: [`You committed “${c.subject}”.`], small: c.id.slice(0, 7), body: () => fileLines(ctx, ctx.files.get(c.id), 'left'), tip: storyTip(c) })
  const fork = hr.fork ? by.get(hr.fork) : undefined
  if (fork && hr.branch !== baseName && hr.branch !== hr.base)
    items.push({ key: 'st:fork', color: YOU, ring: true, when: clock(fork.at, ctx.now), what: [<Text key="b" bold>You started this branch</Text>, ` from ${baseName}, right after “${joinSubject(fork.subject)}”.`], small: hr.branch, body: () => [<Text key="n" dimColor>{`Your branch began at ${fork.id.slice(0, 7)}. Every commit you make goes on top of it.`}</Text>], tip: ['▸ says where it began', [{ t: 'At ', s: 'd' }, { t: fork.id.slice(0, 7), s: 'b' }, SEP, { t: 'by ', s: 'd' }, fork.author], [plural(hr.ahead, 'commit'), { t: ' on it since', s: 'd' }, SEP, `${hr.behind}`, { t: ` on ${baseName} you don't have`, s: 'd' }]] })
  const from = fork ? line.findIndex(c => c.id === fork.id) : line.findIndex(c => !behind.has(c.id))
  for (const c of line.slice(Math.max(0, from)).slice(0, Math.max(2, 7 - items.length))) {
    const pr = prOf(c.subject)
    const taken = c.parents.length > 1 ? takenIn(hr.commits, c, onMain) : null
    const n = taken?.commits.length ?? 0
    items.push({ key: `st:${c.id}`, commit: c.id, color: colorOf(taken?.all[0] ? work.get(taken.all[0].id) : work.get(c.id)), when: clock(c.at, ctx.now), what: pr ? [<Text key="b" bold>{`PR #${pr.pr}`}</Text>, ` ${pr.name} was merged into ${baseName}.`] : [`“${c.subject}” on ${baseName}.`], small: taken ? `${plural(n, 'commit')}${taken.syncs ? `, after ${taken.syncs === 1 ? 'one sync' : `${taken.syncs} syncs`} with ${baseName}` : ''}.` : c.id.slice(0, 7), body: () => (taken ? commitList(ctx, taken.commits, 'left') : fileLines(ctx, ctx.files.get(c.id), 'left')), tip: storyTip(c, taken?.commits.length) })
  }
  const out: any[] = []
  items.forEach((it, i) => {
    const dot = ctx.term ? <Text color={it.color}>{it.hollow ? '◌' : '●'}</Text> : <Text color={it.color}>{it.hollow ? '◌' : it.ring ? '◉' : '●'}</Text>
    out.push(
      <Box key={`item:${it.key}`} flexDirection="row" columnGap={1} paddingX={0.5} hover={{ backgroundColor: LIT }}>
        <Box width={1.5} flexShrink={0} flexDirection="column" alignItems="center">
          {dot}
          {i < items.length - 1 && !ctx.term && <Box width={0.15} flexGrow={1} backgroundColor={RULE} />}
        </Box>
        <Box width={5} flexShrink={0}>
          <Text dimColor>{it.when}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} paddingBottom={i < items.length - 1 && !ctx.term ? 0.5 : 0}>
          <Text wrap="wrap">{it.what}</Text>
          <Box key="small" flexDirection="row" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">
                {it.small}
              </Text>
            </Box>
            <Box marginRight={ctx.graphic ? -0.75 : 0}>
              <Button key={it.key} plain dimColor label={ctx.open.has(it.key) ? '▾' : '▸'} onPress={() => ctx.on.toggle(it.key, it.commit)} />
            </Box>
            {/* Over the item's own sentence, clear of the ▸ above (and of the picker, for the first). */}
            {hoverCard(Box, ctx.surface, { left: 0, width: Math.max(20, Math.min(48, (ctx.columns || 80) - (i === 0 ? 27 : 13))) }, cardLines(Text, ctx.open.has(it.key) ? ['▾ folds it', ...it.tip.slice(1)] : it.tip))}
          </Box>
        </Box>
      </Box>,
    )
    if (ctx.open.has(it.key)) out.push(opened(ctx, it.key, it.body(), 7.5))
  })
  if (!items.length) out.push(<Text key="none" dimColor>{'Nothing to tell yet.'}</Text>)
  return <Box flexDirection="column">{out}</Box>
}

// --- Current · Files tree --------------------------------------------------

function tree(ctx: Ctx) {
  const { Box, Text, Button, Svg } = ctx
  const rows = ctx.rows.filter(r => !r.isCommitted)
  if (!rows.length) return <Text dimColor>{'  Nothing changed: no tree to draw.'}</Text>
  const byPath = new Map(rows.map(r => [r.path, r]))
  const nodes = fileTree(rows.map(r => r.path))
  const tone = (letter: string) => (letter === 'A' || letter === '?' ? '#79c07b' : letter === 'D' ? '#e5737a' : letter === 'U' ? '#e5737a' : '#e3b45d')
  const letterOf = (key: string): string => {
    const r = byPath.get(key)
    if (r) return statusLetter(r.status)
    const inside = rows.filter(x => x.path.startsWith(key)).map(x => statusLetter(x.status))
    return inside.every(l => l === 'A' || l === '?') ? 'A' : inside.every(l => l === 'D') ? 'D' : 'M'
  }
  const at = new Map(nodes.map((n, i) => [n.key, i]))
  const x = (d: number) => 8 + d * 16
  const y = (i: number) => i * H + H / 2
  const paths: { d: string; y1: number; y2: number }[] = []
  nodes.forEach((n, i) => {
    if (n.parent === null) return
    const pi = at.get(n.parent) ?? 0
    const p = nodes[pi]
    if (!p) return
    paths.push({ d: `<path d="M${x(p.depth)} ${y(pi) + 5}L${x(p.depth)} ${y(i) - 7}Q${x(p.depth)} ${y(i)} ${x(p.depth) + 7} ${y(i)}L${x(n.depth) - 5} ${y(i)}" stroke="${tone(letterOf(n.key))}" stroke-width="2" fill="none"/>`, y1: y(pi), y2: y(i) })
  })
  const dot = (n: (typeof nodes)[number], i: number) => {
    if (n.parent === null) return `<circle cx="${x(0)}" cy="${y(i)}" r="5" fill="${BG}" stroke="${FG}" stroke-width="2"/>`
    const c = tone(letterOf(n.key))
    return n.path ? `<circle cx="${x(n.depth)}" cy="${y(i)}" r="4.5" fill="${c}"/>` : `<circle cx="${x(n.depth)}" cy="${y(i)}" r="4.5" fill="${c}55" stroke="${c}" stroke-width="2"/>`
  }
  const widthOf = (i: number) => x(nodes[i]?.depth ?? 0) + 10
  const sliceOf = (i: number) => {
    const top = i * H
    const width = widthOf(i)
    return svgDoc(width, H, paths.filter(p => p.y2 >= top && p.y1 <= top + H).map(p => p.d).join('') + dot(nodes[i] ?? nodes[0]!, i), `0 ${top} ${width} ${H}`)
  }
  const threadOf = (i: number) => {
    // Lines that pass under row i: from a node at or above it to a child below.
    let body = ''
    nodes.forEach((n, j) => {
      if (n.parent === null) return
      const pi = at.get(n.parent) ?? 0
      if (pi <= i && j > i) body += `<path d="M${x(nodes[pi]?.depth ?? 0)} 0L${x(nodes[pi]?.depth ?? 0)} 900" stroke="${tone(letterOf(n.key))}" stroke-width="2"/>`
    })
    return svgDoc(widthOf(i), 900, body)
  }
  const prefix = (i: number) => {
    // The terminal's indented tree: `├─ ` and `└─ ` by whether a sibling follows.
    const n = nodes[i]
    if (!n || n.parent === null) return ''
    let s = ''
    let cur: (typeof nodes)[number] | undefined = n
    const parts: string[] = []
    while (cur && cur.parent !== null) {
      const parentKey: string = cur.parent
      const last = !nodes.slice((at.get(cur.key) ?? 0) + 1).some(m => m.parent === parentKey)
      parts.unshift(cur === n ? (last ? '└─ ' : '├─ ') : last ? '   ' : '│  ')
      cur = nodes[at.get(parentKey) ?? -1]
    }
    s = parts.join('')
    return s
  }
  const out: any[] = []
  nodes.forEach((n, i) => {
    const colCells = Math.ceil((widthOf(i) / CELL) * 10) / 10 + 0.3
    const r = n.path ? byPath.get(n.path) : undefined
    const key = `f:${n.key}`
    const letter = r ? statusLetter(r.status) : ''
    const label =
      n.parent === null ? (
        <Text dimColor>{'repository root'}</Text>
      ) : r ? (
        <Box>
          <Button key={key} plain label={n.label} onPress={() => ctx.on.peek(n.path ?? '')} />
        </Box>
      ) : (
        <Text>{n.label}</Text>
      )
    // A file's card presses for its peek (action); a folder's only counts.
    const explain = r
      ? cardLines(Text, [
          pathPieces(r.path),
          [{ t: letter === 'A' || letter === '?' ? 'New file' : letter === 'D' ? 'Deleted' : 'Changed', s: statusTag(letter) }, ...(r.touch ? [{ t: ` by ${whoWord(r.touch.who)} in turn ${r.touch.turn}`, s: 'd' } as Piece] : []), ...(r.added ? [SEP, { t: `+${r.added}`, s: 'good' } as Piece] : []), ...(r.deleted ? [r.added ? ' ' : SEP, { t: `−${r.deleted}`, s: 'bad' } as Piece] : [])],
          'Click for the first lines of its diff.',
        ])
      : cardLines(Text, [n.parent === null ? 'Repository root' : n.label, `${plural(rows.filter(x => x.path.startsWith(n.key)).length, 'changed file')} below`])
    out.push(
      <Box key={`node:${n.key || 'root'}`} flexDirection="row" alignItems="center" columnGap={0.75} paddingRight={0.5} hover={{ backgroundColor: LIT }}>
        {ctx.graphic ? (
          <Box width={colCells} flexShrink={0}>
            <Svg alt="graph" width={widthOf(i)} height={H} source={sliceOf(i)} />
          </Box>
        ) : (
          <Text dimColor>{prefix(i)}</Text>
        )}
        <Box flexDirection="row" columnGap={0.75} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          {letter && (
            <Box width={1.5} flexShrink={0}>
              <Text color={tone(letter)}>{letter}</Text>
            </Box>
          )}
          {label}
        </Box>
        {r && (
          // Fixed columns, each right-aligned, so the figures line up row to row.
          <Box flexDirection="row" columnGap={0.75} flexShrink={0} alignItems="center">
            <Box width={4} flexShrink={0} flexDirection="row" justifyContent="flex-end">
              {r.touch && light(ctx, 'turn', `T${r.touch.turn}`, 'claude')}
            </Box>
            <Box width={4.5} flexShrink={0} flexDirection="row" justifyContent="flex-end">
              {r.added ? <Text color="success">{`+${r.added}`}</Text> : null}
            </Box>
            <Box width={4.5} flexShrink={0} flexDirection="row" justifyContent="flex-end">
              {r.deleted ? <Text color="error">{`−${r.deleted}`}</Text> : null}
            </Box>
          </Box>
        )}
        {card(ctx, key, colCells + 1, explain, 1, r ? 'action' : 'info')}
      </Box>,
    )
    if (r && ctx.open.has(key)) {
      const peek = ctx.peeks.get(r.path)
      const lines = peek === 'reading' || peek === undefined ? [<Text key="r" dimColor>{'Reading the diff…'}</Text>] : peek.length && ctx.Code ? [<ctx.Code key="diff" source={peek.join("\n")} format="diff" path={r.path} wrap="truncate-end" />] : peek.length ? peek.map((l, k) => <Text key={`p${k}`} color={l.startsWith('+') ? 'success' : l.startsWith('-') ? 'error' : l.startsWith('@@') ? DIM : undefined} wrap="truncate-end">{l}</Text>) : [<Text key="r" dimColor>{'No lines to show.'}</Text>]
      const line = ctx.graphic ? (
        <Box key="thread" width={colCells} flexShrink={0} overflow="hidden">
          <Box position="absolute" top={0} left={0}>
            <Svg alt="graph" width={widthOf(i)} height={900} source={threadOf(i)} />
          </Box>
        </Box>
      ) : undefined
      out.push(opened(ctx, key, lines, 0, line))
    }
  })
  if (ctx.graphic)
    out.push(
      <Box key="legend" flexDirection="row" columnGap={1.5} paddingX={0.5} marginTop={0.5}>
        <Text color="#e3b45d">● changed</Text>
        <Text color="#79c07b">● new</Text>
        <Text color="#e5737a">● deleted</Text>
        <Text dimColor>○ folder</Text>
      </Box>,
    )
  return <Box flexDirection="column">{out}</Box>
}

export { shortBranch }
