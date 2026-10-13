// The Changes pane: a header with the totals and the baseline, the rows
// grouped as the settings say, and the pressed row's peek. Pure drawing over
// what register.tsx read.
//
// Every row is columns: the status letter, the path taking the room left,
// then a right-hand cluster of fixed widths (pills, bar, +, −, age), so the
// figures line up from row to row. The desktop draws the pills on a tint; the
// terminal colors their words. Nothing here changes the repository: the only
// presses are Refresh, Show/Fold and, with the peek on, a path.
//
// Hovering a cell, a path, a group's title or the header opens a card with
// what the figure stands for. Cards keep to the right-hand cells when the
// paths above are pressable (the peek on), and open downward from the pane's
// root near its top, where an upward one would be cut off.

import type { ChangesDrillSnapshot, ChangesDrillTurn } from '../types'
import { ago, barCells, isGenerated, isSensitive, isSource, isStaged, isTest, isUnstaged, scopeOf, sensitiveRule, stageWord, statusColor, statusLetter, statusWord } from './git.ts'
import { clock } from './history.ts'
import { cardLines, hoverCard, keeps, pathPieces, plusMinus, SEP, statusTag } from './historyView.tsx'
import type { CardAt, CardLine, CardTexts, Piece, Tone } from './historyView.tsx'
import type { Reading, Row, Settings } from './register.tsx'

export type View = {
  Box: any
  Text: any
  Button: any
  Code: any
  isDesktop: boolean
  surface: string
  // The pane body's width in cells; 0 when unknown.
  columns: number
  // The cards that open downward from the pane's root: the caller draws them
  // last, so they paint over every row.
  floating: any[]
  settings: Settings
  // undefined before the first reading, null outside a repository.
  reading: Reading | null | undefined
  turns: readonly ChangesDrillTurn[]
  session: ChangesDrillSnapshot | null
  now: number
  selected: string | null
  showGenerated: boolean
  // The turns before the last two drawn; folded under one line otherwise.
  showOlder?: boolean
  peek: readonly string[] | null
  // The ladder's level (see BUDGET in historyView.tsx): 3 keeps only the last
  // turn open, 4 cuts the list to 30 rows.
  level?: number
  on: {
    refresh: () => void
    select: (path: string) => void
    toggleGenerated: () => void
    toggleOlder?: () => void
  }
}

// The rows the list draws, and from level 4 of the ladder.
const ROWS = 150
const FEW_ROWS = 30

// The pills: a word's color, and on the desktop the tint behind it (tuned
// for a dark theme; on a light one they read as dark chips).
const PILLS = {
  claude: { fg: '#8db4f0', bg: '#1d3150' },
  agent: { fg: '#b4a8f5', bg: '#2e2852' },
  shell: { fg: '#e8a17c', bg: '#3c271c' },
  you: { fg: '#a8a8a8', bg: '#2c2c2c' },
  warn: { fg: '#e9b252', bg: '#3a2c0e' },
  danger: { fg: '#ef8c8c', bg: '#451c1c' },
} as const
const HOVER = '#ffffff0d'
const TRACK = '#ffffff1f'

// Widths in cells of the right-hand columns.
const W = { letter: 1.5, who: 7, bar: 6, plus: 4.5, minus: 4.5, age: 3.5 }

const trim = (path: string) => path.replace(/\/$/, '')
const name = (path: string) => trim(path).slice(trim(path).lastIndexOf('/') + 1) + (path.endsWith('/') ? '/' : '')
const dir = (path: string) => (trim(path).includes('/') ? trim(path).slice(0, trim(path).lastIndexOf('/') + 1) : './')
const sum = (rows: readonly Row[], k: 'added' | 'deleted') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const whoWord = (who: string) => (who === 'claude' ? 'Claude' : who === 'agent' ? 'a subagent' : "Claude's shell")

// A short, stable name for a path or a title: a hover scope holds 64
// characters at most.
function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

type Texts = CardTexts

// A line's pieces, a plain string as a dim one; and lines joined into one.
const pieces = (line: CardLine): Piece[] => (typeof line === 'string' ? [{ t: line, s: 'd' }] : line)
const joined = (lines: Texts): Piece[] => lines.filter((l): l is CardLine => !!l && l.length > 0).flatMap((l, i) => (i ? [SEP, ...pieces(l)] : pieces(l)))

// A card for a host whose top sits `y` cells down the pane: upward, inside the
// keyed host, when it fits under the header (an upward card is cut off at the
// pane's top, and would cover Refresh); else from the pane's root, downward
// under the host, revealed by a scope the host then names in its `hover`.
// `tone`: the card's kind, its accent bar (a local press, a status, or info).
function tip(view: View, y: number, id: string, texts: Texts, up: CardAt, down: CardAt, tone: Tone = 'info', height = 1): { card: any; hover?: { scope?: string; backgroundColor: string } } {
  const { Box, Text, surface } = view
  const lines = cardLines(Text, texts)
  // A card the ladder drops leaves its host as it is with no card: no scope, no light.
  if (surface === 'mobile' || !lines.length || !keeps(tone)) return { card: null }
  const tall = lines.length + (surface === 'terminal' ? 2 : 0.6)
  if (tall <= y - (view.isDesktop ? 1.5 : 1)) return { card: hoverCard(Box, surface, { ...up, bottom: 1 }, lines, tone), hover: { backgroundColor: LIGHT } }
  const scope = `tip:${id}`
  // Downward it would trap a pointer going down the pane (the pointer on a card
  // is on its host): narrow, at the right, the labels on the left stay clear.
  const narrow = Math.min(down.width ?? 48, Math.max(24, Math.round((view.columns || 80) * 0.6)))
  view.floating.push(hoverCard(Box, surface, { right: 0, width: narrow, top: Math.ceil(y + height), scope }, cardLines(Text, texts, 5, 'wrap'), tone))
  return { card: null, hover: { scope, backgroundColor: LIGHT } }
}
// A card host's faint light while hovered: says a card is there.
const LIGHT = '#ffffff10'

// The right-hand cells every row of a kind draws (no pills), in cells: as wide
// as a card may be without reaching a pressable path above it.
function fixedWidth(view: View, withWho: boolean) {
  const s = view.settings
  const widths = [withWho && s.author ? W.who : 0, s.bars === 'off' ? 0 : s.bars === 'blocks' ? W.bar : 7, W.plus, W.minus, s.age ? W.age : 0].filter(n => n > 0)
  return widths.reduce((a, b) => a + b, 0) + widths.length - 1
}
const cardWidth = (view: View, fixed: number) => (view.settings.peek ? Math.max(20, Math.min(48, Math.floor(fixed))) : 48)

// Each row's group: its title, and the order groups sort by (lower first).
function groupOf(view: View, row: Row): { title: string; order: number } {
  const { settings: s, turns } = view
  if (row.isCommitted) return { title: 'Committed on this branch', order: 1e9 }
  switch (s.group) {
    case 'turn': {
      if (!row.touch) return { title: 'Not changed in a turn of this session', order: 1e8 }
      const turn = turns.find(t => t.n === row.touch?.turn)
      const said = turn?.text ? ` · ${turn.text}` : ''
      return { title: row.touch.turn === 0 ? 'Before the first turn' : `Turn ${row.touch.turn}${said}`, order: -row.touch.turn }
    }
    case 'folder':
      return { title: dir(row.path), order: 0 }
    case 'author': {
      const who = row.touch?.who
      return who === 'claude' ? { title: 'Claude', order: 0 } : who === 'agent' ? { title: 'Subagents', order: 1 } : who === 'shell' ? { title: "Claude's shell commands", order: 2 } : { title: 'You, outside Claude', order: 3 }
    }
    case 'stage':
      return row.status === '??'
        ? { title: 'Untracked', order: 3 }
        : isStaged(row.status) && isUnstaged(row.status)
          ? { title: 'Partly staged', order: 1 }
          : isStaged(row.status)
            ? { title: 'Staged', order: 0 }
            : { title: 'Unstaged', order: 2 }
    default:
      return { title: '', order: 0 }
  }
}

// A group title's card: its files, the turn's whole prompt and time, what the
// group means.
function groupFacts(view: View, title: string, rows: readonly Row[]): Texts {
  const first = rows[0]?.touch
  const turn = view.settings.group === 'turn' && first ? view.turns.find(t => t.n === first.turn) : undefined
  const meaning: Record<string, string> = {
    'Committed on this branch': `In commits since ${(view.reading as Reading).against}, not in the work tree`,
    'Not changed in a turn of this session': 'No edit or shell command of this session touched them',
    'Before the first turn': 'Changed before the first prompt',
    Staged: 'In the index: the next commit takes them',
    'Partly staged': 'Some changes in the index, some only on disk',
    Unstaged: 'Changed on disk, not added to the index',
    Untracked: 'New to git: never added',
    "Claude's shell commands": "Changed in a turn whose shell ran a command that writes",
    'You, outside Claude': 'No edit by Claude recorded for them',
  }
  return [[plural(rows.length, 'file'), SEP, plural(sum(rows, 'added') + sum(rows, 'deleted'), 'line')], turn?.text && [{ t: turn.text, s: 'i' }], turn?.at ? [{ t: 'The turn began ', s: 'd' }, clock(turn.at, view.now)] : null, meaning[title]]
}

// Who changed a file, for its pill's card.
function whoFacts(view: View, row: Row): Texts {
  const t = row.touch
  if (!t) return ['No edit by Claude recorded for it', 'Made outside Claude, or before tracking began,', 'or missed when the transcript was read back']
  const turn = view.turns.find(x => x.n === t.turn)
  return [
    t.turn === 0 ? 'Before the first turn' : turn?.text ? [{ t: `Turn ${t.turn}`, s: 'd' }, SEP, { t: turn.text, s: 'i' }] : `Turn ${t.turn}`,
    `${plural(t.edits, 'edit')} by ${whoWord(t.who)}${t.at ? ` · the last at ${clock(t.at, view.now)}` : ''}`,
    !t.at && 'Read back from the transcript: no time kept',
    t.who === 'shell' && 'No Edit or Write named it: a shell command did',
  ]
}

// A file's lines, for the bar's, the +'s and the −'s cards.
function lineFacts(view: View, row: Row, max: number): Texts {
  const r = view.reading as Reading
  if (row.added === null && row.deleted === null)
    return row.status === '??' ? ['Untracked: its lines are not counted', 'A folder, a binary file, one over 512 KB,', 'or past the first 40 files read'] : ['Binary: git counts no lines for it']
  const a = row.added ?? 0
  const d = row.deleted ?? 0
  return [[...plusMinus(a, d), SEP, `${plural(a + d, 'line')} changed`], `Against ${r.against}${r.base !== 'HEAD' ? ` at ${r.base.slice(0, 7)}` : ''}`, `The bar's scale: ${max} lines, the most of a file shown`, row.status === '??' && 'Counted from the file: git has no diff for it']
}

function ageFacts(view: View, row: Row): Texts {
  if (row.changedAt === undefined) return []
  const m = Math.round((view.now - row.changedAt) / 60_000)
  const t = row.touch
  return [
    [{ t: 'Last changed ', s: 'd' }, clock(row.changedAt, view.now), { t: ` · ${m < 120 ? `${m} min` : `${Math.round(m / 60)} h`} ago`, s: 'd' }],
    t?.at && t.at === row.changedAt ? `By ${whoWord(t.who)}, in turn ${t.turn}` : "The file's own modified time",
  ]
}

function sorted(view: View, rows: readonly Row[]) {
  const by: Record<Settings['sort'], (a: Row, b: Row) => number> = {
    recent: (a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0) || a.path.localeCompare(b.path),
    lines: (a, b) => (b.added ?? 0) + (b.deleted ?? 0) - ((a.added ?? 0) + (a.deleted ?? 0)) || a.path.localeCompare(b.path),
    path: (a, b) => a.path.localeCompare(b.path),
    status: (a, b) => statusLetter(a.status).localeCompare(statusLetter(b.status)) || a.path.localeCompare(b.path),
  }
  return [...rows].sort(by[view.settings.sort])
}

// A figure right-aligned in a column of its own width.
function cell(view: View, key: string, width: number, child: any, card: any = null, hover?: object) {
  const { Box } = view
  return (
    <Box key={key} width={width} flexShrink={0} justifyContent="flex-end" hover={hover}>
      {child}
      {card}
    </Box>
  )
}

// A pill: a Box on both surfaces, so it can host its card; unkeyed inside a
// cell that hosts one already.
function pill(view: View, key: string | undefined, word: string, tone: keyof typeof PILLS, card: any = null, hover?: object) {
  const { Box, Text, isDesktop } = view
  const p = PILLS[tone]
  return (
    <Box key={key} flexShrink={0} backgroundColor={isDesktop ? p.bg : undefined} paddingX={isDesktop ? 0.5 : 0} hover={hover}>
      <Text color={p.fg}>{word}</Text>
      {card}
    </Box>
  )
}

export function changesPane(view: View) {
  const { Box, Text, Button, settings: s, reading: r, on, isDesktop } = view
  if (r === undefined) return <Text dimColor>Reading the changes…</Text>
  const pad = isDesktop ? 0.5 : 0
  const refresh = <Button key="refresh" plain dimColor label="Refresh" onPress={() => on.refresh()} />
  if (r === null)
    return (
      <Box flexDirection="row" justifyContent="space-between" paddingX={pad}>
        <Text color="subtle">Not in a git repository.</Text>
        {refresh}
      </Box>
    )

  const generated = s.fold ? r.rows.filter(row => isGenerated(row.path)) : []
  const shown = s.fold && !view.showGenerated ? r.rows.filter(row => !isGenerated(row.path)) : r.rows
  const max = Math.max(1, ...shown.map(row => (row.added ?? 0) + (row.deleted ?? 0)))
  const testedScopes = new Set(r.rows.filter(row => isTest(row.path)).map(row => scopeOf(row.path)))
  const since = r.against === 'session start' && view.session ? ` (${ago(view.now - view.session.at)} ago)` : ''
  const columns = view.columns || 80
  const width = cardWidth(view, fixedWidth(view, true))

  // How far down the pane each row sits, in cells, so a card near the top
  // can open downward instead.
  let y = isDesktop ? 0.5 : 0
  const work = r.rows.filter(row => !row.isCommitted)
  const committed = r.rows.length - work.length
  const facts = tip(
    view,
    y,
    'head',
    [
      [`${work.filter(row => isStaged(row.status)).length} staged`, SEP, `${work.filter(row => isUnstaged(row.status)).length} unstaged`, SEP, `${work.filter(row => row.status === '??').length} untracked`, ...(committed ? [SEP, `${committed} committed`] : [])],
      [{ t: 'Against ', s: 'd' }, r.against, ...(r.base !== 'HEAD' ? [{ t: ' at ', s: 'd' } as Piece, { t: r.base.slice(0, 7), s: 'b' } as Piece] : []), SEP, { t: 'the baseline option: ', s: 'd' }, s.baseline],
      [{ t: 'On ', s: 'd' }, r.branch, SEP, ...pathPieces(r.top)],
    ],
    {},
    { left: 0 },
  )
  const refreshFacts = tip(
    view,
    y,
    'refresh',
    [
      `Refresh re-reads git status and the diff vs ${r.against}`,
      [{ t: 'Last read ', s: 'd' }, clock(r.at, view.now)],
      s.refresh === 'manual' ? 'Not live: read on open and on Refresh only' : [{ t: 'Live', s: 'good' }, { t: `: read again after each ${s.refresh === 'each edit' ? 'edit' : 'turn'} while open`, s: 'd' }],
      s.peek && view.selected ? 'The open peek is read again too' : null,
    ],
    {},
    { right: 0 },
    'action',
  )
  const header = (
    <Box key="header" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={pad}>
      <Box flexDirection="row" columnGap={1} flexShrink={1} flexWrap="wrap" hover={facts.hover}>
        <Text bold>{plural(r.rows.length, 'file')}</Text>
        <Text color="success">{`+${sum(r.rows, 'added')}`}</Text>
        <Text color="error">{`−${sum(r.rows, 'deleted')}`}</Text>
        <Text dimColor>{`vs ${r.against}${since} · ${r.branch}`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0} alignItems="center" hover={refreshFacts.hover}>
        {s.refresh !== 'manual' && <Text color="success">●</Text>}
        {s.refresh !== 'manual' && <Text dimColor>live</Text>}
        {refresh}
      </Box>
    </Box>
  )
  y += 1
  if (r.rows.length === 0)
    return (
      <Box flexDirection="column" rowGap={1}>
        {header}
        <Box paddingX={pad}>
          <Text color="subtle">{`Nothing changed against ${r.against}.`}</Text>
        </Box>
      </Box>
    )

  const out: any[] = [header]

  if (s.guard) {
    const secrets = r.rows.filter(row => row.status === '??' && isSensitive(row.path))
    if (secrets.length) {
      const text = `⚠ ${secrets.map(row => row.path).join(', ')} ${secrets.length === 1 ? 'looks sensitive and is' : 'look sensitive and are'} not in .gitignore`
      const tall = Math.max(1, Math.ceil(text.length / Math.max(20, columns - 1)))
      y += isDesktop ? 0.5 : 0
      const t = tip(view, y, 'secrets', [`git add . would take ${secrets.length === 1 ? 'it' : 'them'}: list ${secrets.length === 1 ? 'it' : 'them'} in .gitignore`, ...secrets.slice(0, 3).map(row => [...pathPieces(row.path), SEP, { t: sensitiveRule(row.path) ?? '', s: 'bad' as const }]), secrets.length > 3 && `+${secrets.length - 3} more`, 'Matched on the name alone; nothing is read'], {}, { left: 0 }, 'danger', tall)
      out.push(
        <Box key="secrets" paddingX={pad} marginTop={isDesktop ? 0.5 : 0} hover={t.hover}>
          <Text color="error">{text}</Text>
        </Box>,
      )
      y += tall
    }
  }

  const groups = new Map<string, { order: number; rows: Row[] }>()
  for (const row of shown) {
    const g = groupOf(view, row)
    const known = groups.get(g.title) ?? { order: g.order, rows: [] }
    known.rows.push(row)
    groups.set(g.title, known)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
  // By turn, the last two turns are open (the last one only from level 3); the
  // ones before fold under one line.
  const level = view.level ?? 0
  const keep = level >= 3 ? 1 : 2
  const cap = level >= 4 ? FEW_ROWS : ROWS
  const turnGroups = s.group === 'turn' ? ordered.filter(([, g]) => g.order <= 0).map(([t]) => t) : []
  const older = new Set(turnGroups.slice(keep))
  const olderRows = ordered.filter(([t]) => older.has(t)).flatMap(([, g]) => g.rows)
  const visible = view.showOlder ? ordered : ordered.filter(([t]) => !older.has(t))
  const lastTurn = [...visible].reverse().find(([t]) => turnGroups.includes(t))?.[0]
  let drawn = 0
  const gap = s.density === 'comfortable' ? (isDesktop ? 0.5 : 1) : 0
  for (const [title, g] of visible) {
    if (drawn >= cap) break
    const body: any[] = []
    y += 1
    if (title) {
      const t = tip(view, y, `g:${hash(title)}`, groupFacts(view, title, g.rows), { right: 0, width }, { right: 0, width })
      body.push(
        <Box key={`group:${title}`} flexDirection="row" justifyContent="space-between" columnGap={1} paddingX={pad} hover={t.hover}>
          <Box flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{title}</Text>
          </Box>
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            {cell(view, 'plus', W.plus, sum(g.rows, 'added') ? <Text dimColor>{`+${sum(g.rows, 'added')}`}</Text> : null)}
            {cell(view, 'minus', W.minus, sum(g.rows, 'deleted') ? <Text dimColor>{`−${sum(g.rows, 'deleted')}`}</Text> : null)}
            {s.age && cell(view, 'age', W.age, null)}
          </Box>
          {t.card}
        </Box>,
      )
      y += 1 + gap
    }
    for (const row of sorted(view, g.rows)) {
      if (drawn >= cap) break
      drawn += 1
      body.push(fileRow(view, row, max, s.group === 'folder', testedScopes, y))
      y += 1 + gap
      if (view.selected === row.path) {
        const more = details(view, row)
        if (more) body.push(more)
        if (more) y += Math.max(1, view.peek?.length ?? 0) + (isDesktop ? 0.5 : 0) + gap
      }
    }
    out.push(
      <Box key={`rows:${title}`} flexDirection="column" marginTop={1} rowGap={s.density === 'comfortable' ? (isDesktop ? 0.5 : 1) : 0}>
        {body}
      </Box>,
    )
    if (title === lastTurn && older.size) {
      const turnsOf = [...new Set(olderRows.map(row => row.touch?.turn ?? 0))].sort((a, b) => a - b)
      const span = turnsOf.length > 1 ? `Turns ${turnsOf[0]} to ${turnsOf[turnsOf.length - 1]}` : `Turn ${turnsOf[0]}`
      const t = tip(view, y + 1, 'older', [`${view.showOlder ? 'Folds' : 'Shows'} the ${plural(older.size, 'older turn')}`, [{ t: span.replace('Turn 0', 'before the first turn'), s: 'd' }, SEP, plural(olderRows.length, 'file'), SEP, ...plusMinus(sum(olderRows, 'added'), sum(olderRows, 'deleted'))], keep === 1 ? 'Only the last turn stays open: the pane is too full for more' : 'The last two turns always stay open'], { right: 0, width }, { right: 0, width }, 'action')
      out.push(
        <Box key="older" flexDirection="row" columnGap={1} marginTop={1} paddingX={pad} alignItems="center" hover={t.hover}>
          <Text dimColor>{`${plural(older.size, 'older turn')} ${view.showOlder ? 'shown' : 'folded'} · ${plural(olderRows.length, 'file')} · +${sum(olderRows, 'added')} −${sum(olderRows, 'deleted')}`}</Text>
          <Button key="older-toggle" plain dimColor label={view.showOlder ? 'Fold' : 'Show'} onPress={() => on.toggleOlder?.()} />
          {t.card}
        </Box>,
      )
      y += 2
    }
  }
  if (shown.length - (view.showOlder ? 0 : olderRows.length) > drawn) {
    const hidden = visible.flatMap(([, g]) => sorted(view, g.rows)).slice(drawn)
    const t = tip(view, y, 'more', [cap < ROWS ? `The list stops at ${cap} rows, the pane too full for more; past it:` : `The list stops at ${ROWS} rows; past it:`, ...hidden.slice(0, 3).map(row => pathPieces(row.path)), hidden.length > 3 && `+${hidden.length - 3} more`], { right: 0, width }, { right: 0, width })
    out.push(
      <Box key="more" paddingX={pad} hover={t.hover}>
        <Text dimColor>{cap < ROWS ? `⋮ ${hidden.length} more · the pane is too full to draw them` : `⋮ ${hidden.length} more`}</Text>
        {t.card}
      </Box>,
    )
    y += 1
  }

  if (generated.length) {
    // One card for the line and its button: the press first, then the files.
    const t = tip(
      view,
      y + 1,
      'generated',
      [`${view.showGenerated ? 'Folds' : 'Shows'} the ${plural(generated.length, 'generated file')}`, ...generated.slice(0, 3).map(row => [...pathPieces(row.path), SEP, ...plusMinus(row.added ?? 0, row.deleted ?? 0)]), generated.length > 3 ? `+${generated.length - 3} more` : 'Lockfiles, build output, maps, snapshots'],
      { right: 0, width },
      { right: 0, width },
      'action',
    )
    out.push(
      <Box key="generated" flexDirection="row" columnGap={1} marginTop={1} paddingX={pad} alignItems="center" hover={t.hover}>
        <Text dimColor>{`${plural(generated.length, 'generated file')} ${view.showGenerated ? 'shown' : 'folded'} · ${generated.map(row => name(row.path)).slice(0, 3).join(', ')} · +${sum(generated, 'added')} −${sum(generated, 'deleted')}`}</Text>
        <Button key="generated-toggle" plain dimColor label={view.showGenerated ? 'Fold' : 'Show'} onPress={() => on.toggleGenerated()} />
        {t.card}
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" paddingY={isDesktop ? 0.5 : 0}>
      {out}
    </Box>
  )
}

// A file's row at `y` cells down the pane, with one card for the whole row:
// a card per cell made the tree too heavy for the desktop, which then stopped
// answering the pane's git reads. Anchored at the row's right edge, over the
// figures; narrow with the peek on, so it never covers a path to press.
function fileRow(view: View, row: Row, max: number, byFolder: boolean, testedScopes: Set<string>, y: number) {
  const { Box, Text, Button, settings: s, on, isDesktop } = view
  const r = view.reading as Reading
  const label = byFolder ? name(row.path) : row.path
  const id = hash(row.path)
  // Each cell: its key, its width in cells, whether every row of its kind has
  // one, its card's lines, and how it draws with the card.
  type Cell = { key: string; width: number; isFixed: boolean; texts: Texts; draw: (card: any, hover?: object) => any }
  const cells: Cell[] = []
  const pillWidth = (word: string) => word.length + (isDesktop ? 1 : 0)
  const addPill = (key: string, word: string, tone: keyof typeof PILLS, texts: Texts) => cells.push({ key, width: pillWidth(word), isFixed: false, texts, draw: (card, hover) => pill(view, key, word, tone, card, hover) })
  if (s.author && !row.isCommitted) {
    const who = row.touch?.who
    const [word, tone] = who === 'claude' ? ['Claude', 'claude'] : who === 'agent' ? ['agent', 'agent'] : who === 'shell' ? ['shell', 'shell'] : ['you', 'you']
    // A column of its own width, so the bars start at one x whatever the word.
    cells.push({
      key: 'who',
      width: W.who,
      isFixed: true,
      texts: whoFacts(view, row),
      draw: (card, hover) => (
        <Box key="who" width={W.who} flexShrink={0} flexDirection="row" justifyContent="flex-end" hover={hover}>
          {pill(view, undefined, word as string, tone as keyof typeof PILLS)}
          {card}
        </Box>
      ),
    })
  }
  const touch = row.touch
  if (s.churn && touch && touch.edits >= s.churnEdits) addPill('churn', `↻ ×${touch.edits}`, 'warn', [[{ t: plural(touch.edits, 'edit'), s: 'warn' }, { t: ` this session, the last in turn ${touch.turn}`, s: 'd' }], `Flagged from ${s.churnEdits} edits: the churnEdits option`])
  if (s.guard && isSensitive(row.path)) addPill('sensitive', 'sensitive', 'danger', [[{ t: 'The name looks like ', s: 'd' }, { t: sensitiveRule(row.path) ?? '', s: 'bad' }], row.status === '??' ? 'Untracked and not in .gitignore: git add takes it' : 'Tracked: git already holds it', 'Matched on the name alone; nothing is read'])
  else if (s.guard && s.scope && !row.path.startsWith(s.scope)) addPill('scope', 'outside scope', 'warn', [[{ t: 'Not under ', s: 'd' }, { t: s.scope, s: 'warn' }], 'The scope option: where changes are meant to be'])
  if (s.tests && isSource(row.path) && statusLetter(row.status) !== 'D' && !testedScopes.has(scopeOf(row.path))) addPill('tests', 'no test', 'you', [`No test changed in ${scopeOf(row.path) || 'the root folder'}`, 'A source file changed with no test beside it'])

  const lines = lineFacts(view, row, max)
  if (s.bars !== 'off') {
    const n = s.bars === 'blocks' ? 5 : 10
    const c = barCells(row.added, row.deleted, max, n)
    const [full, empty] = s.bars === 'blocks' ? ['■', '□'] : ['━', '─']
    const width = s.bars === 'blocks' ? W.bar : 7
    if (isDesktop && s.bars === 'blocks') {
      // Squares as boxes: a glyph's width varies with the font, a box's does not.
      const tone = (i: number) => (i < c.plus ? 'success' : i < c.plus + c.minus ? 'error' : TRACK)
      cells.push({
        key: 'bar',
        width,
        isFixed: true,
        texts: lines,
        draw: (card, hover) => (
          <Box key="bar" flexShrink={0} width={W.bar} flexDirection="row" columnGap={0.3} alignItems="center" hover={hover}>
            {[0, 1, 2, 3, 4].map(i => (
              <Box key={`sq${i}`} width={0.9} height={0.38} backgroundColor={tone(i)} />
            ))}
            {card}
          </Box>
        ),
      })
    } else
      cells.push({
        key: 'bar',
        width,
        isFixed: true,
        texts: lines,
        draw: (card, hover) => (
          <Box key="bar" flexShrink={0} width={width} hover={hover}>
            <Text>
              {c.plus > 0 && <Text color="success">{full.repeat(c.plus)}</Text>}
              {c.minus > 0 && <Text color="error">{full.repeat(c.minus)}</Text>}
              {c.empty > 0 && <Text dimColor>{empty.repeat(c.empty)}</Text>}
            </Text>
            {card}
          </Box>
        ),
      })
  }
  const binary = row.added === null && row.deleted === null && row.status !== '??'
  const plus = binary ? <Text dimColor>bin</Text> : row.added ? <Text color="success">{`+${row.added}`}</Text> : null
  const minus = row.deleted ? <Text color="error">{`−${row.deleted}`}</Text> : null
  const age = row.changedAt !== undefined ? <Text dimColor>{ago(view.now - row.changedAt)}</Text> : null
  cells.push({ key: 'plus', width: W.plus, isFixed: true, texts: plus ? lines : [], draw: (card, hover) => cell(view, 'plus', W.plus, plus, card, hover) })
  cells.push({ key: 'minus', width: W.minus, isFixed: true, texts: minus ? lines : [], draw: (card, hover) => cell(view, 'minus', W.minus, minus, card, hover) })
  if (s.age) cells.push({ key: 'age', width: W.age, isFixed: true, texts: ageFacts(view, row), draw: (card, hover) => cell(view, 'age', W.age, age, card, hover) })

  const width = cardWidth(view, cells.filter(c => c.isFixed).reduce((n, c) => n + c.width + 1, -1))
  const right = cells.map(c => c.draw(null))

  // The path presses only with the peek on: it shows the diff, nothing more.
  const pressable = s.peek
  // The flags' own words, after the status: what a pill stands for.
  const flags = cells.filter(c => !c.isFixed).map(c => c.texts[0]).filter(Boolean)
  const who = cells.find(c => c.key === 'who')?.texts[0]
  // Its kind: a sensitive file is a status to know; else the peek's press.
  const tone: Tone = s.guard && isSensitive(row.path) ? 'danger' : pressable ? 'action' : 'info'
  const t = tip(
    view,
    y,
    id,
    [
      pressable ? (view.selected === row.path ? 'Press the path to close the peek' : `Press the path to peek at the first ${s.peekLines} diff lines`) : null,
      pathPieces(row.path),
      [{ t: statusWord(row.status), s: statusTag(statusLetter(row.status)) }, SEP, row.isCommitted ? `committed since ${r.against}` : stageWord(row.status)],
      ...flags,
      who,
      joined([lines[0], pressable ? null : ageFacts(view, row)[0]]),
    ],
    { right: 0, width },
    { right: 0, width },
    tone,
  )
  // The row's light keeps a short scope: a scope holds 64 characters, a path more.
  const scope = `row:${id}`
  return (
    <Box key={`row:${row.path}`} flexDirection="row" alignItems="center" columnGap={1} paddingX={isDesktop ? 0.5 : 0} hover={t.hover ?? (isDesktop ? { scope, backgroundColor: HOVER } : undefined)}>
      <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1} minWidth={0}>
        <Box width={W.letter} flexShrink={0}>
          <Text color={statusColor(row.status)}>{statusLetter(row.status)}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          {pressable ? (
            <Box marginLeft={isDesktop ? -0.75 : 0}>
              <Button key={`file:${row.path}`} plain dimColor label={label} onPress={() => on.select(row.path)} />
            </Box>
          ) : (
            <Text dimColor wrap="truncate-start">
              {label}
            </Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
        {right}
      </Box>
      {t.card}
    </Box>
  )
}

// Under a pressed row: the peek, as a diff.
function details(view: View, row: Row) {
  const { Box, Text, Code, settings: s, isDesktop } = view
  const peek = s.peek ? view.peek : null
  if (!peek) return null
  return (
    <Box key={`details:${row.path}`} flexDirection="column" marginLeft={isDesktop ? 2.5 : 2} marginRight={pad(view)} marginY={isDesktop ? 0.25 : 0}>
      {peek.length > 0 && <Code source={peek.join('\n')} format="diff" path={row.path} wrap="truncate-end" />}
      {peek.length === 0 && <Text dimColor>No lines to show.</Text>}
    </Box>
  )
}

const pad = (view: View) => (view.isDesktop ? 0.5 : 0)
