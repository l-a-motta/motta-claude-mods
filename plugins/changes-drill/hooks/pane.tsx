// The Changes pane: a header with the totals and the baseline, the review
// budget, the rows grouped as the settings say, the pressed row's peek, and
// the commit plan. Pure drawing over what register.tsx read.
//
// Every row is columns: the status letter, the path taking the room left,
// then a right-hand cluster of fixed widths (pills, bar, +, −, age), so the
// figures line up from row to row. The desktop draws the pills on a tint; the
// terminal colors their words. Nothing here changes the repository: the only
// presses are Refresh, Show/Fold and, with the peek on, a path.

import type { ChangesDrillSnapshot, ChangesDrillTurn } from '../types'
import { ago, barCells, commitPlan, isGenerated, isSensitive, isSource, isStaged, isTest, isUnstaged, scopeOf, statusColor, statusLetter } from './git.ts'
import type { Reading, Row, Settings } from './register.tsx'

export type View = {
  Box: any
  Text: any
  Button: any
  Code: any
  isDesktop: boolean
  settings: Settings
  // undefined before the first reading, null outside a repository.
  reading: Reading | null | undefined
  turns: readonly ChangesDrillTurn[]
  session: ChangesDrillSnapshot | null
  now: number
  selected: string | null
  showGenerated: boolean
  peek: readonly string[] | null
  on: {
    refresh: () => void
    select: (path: string) => void
    toggleGenerated: () => void
  }
}

const ROWS = 150

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
const W = { letter: 1.5, plus: 4.5, minus: 4.5, age: 3.5 }

const trim = (path: string) => path.replace(/\/$/, '')
const name = (path: string) => trim(path).slice(trim(path).lastIndexOf('/') + 1) + (path.endsWith('/') ? '/' : '')
const dir = (path: string) => (trim(path).includes('/') ? trim(path).slice(0, trim(path).lastIndexOf('/') + 1) : './')
const lines = (rows: readonly Row[]) => rows.reduce((n, r) => n + (r.added ?? 0) + (r.deleted ?? 0), 0)
const sum = (rows: readonly Row[], k: 'added' | 'deleted') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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
function cell(view: View, key: string, width: number, child: any) {
  const { Box } = view
  return (
    <Box key={key} width={width} flexShrink={0} justifyContent="flex-end">
      {child}
    </Box>
  )
}

function pill(view: View, key: string, word: string, tone: keyof typeof PILLS) {
  const { Box, Text, isDesktop } = view
  const p = PILLS[tone]
  if (!isDesktop)
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

// A line across the pane's width, filled to `share` (0 to 1) in `color`.
function meter(view: View, key: string, share: number, color: string) {
  const { Box, Text, isDesktop } = view
  const pct = Math.round(Math.max(0, Math.min(1, share)) * 100)
  if (isDesktop)
    return (
      <Box key={key} width="100%" height={0.25} backgroundColor={TRACK} flexDirection="row">
        {pct > 0 && <Box width={`${pct}%`} height={0.25} backgroundColor={color} />}
      </Box>
    )
  const cells = 40
  const filled = Math.round((pct / 100) * cells)
  return (
    <Text key={key}>
      {filled > 0 && <Text color={color}>{'━'.repeat(filled)}</Text>}
      {filled < cells && <Text dimColor>{'─'.repeat(cells - filled)}</Text>}
    </Text>
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
  const reviewable = r.rows.filter(row => !isGenerated(row.path))
  const max = Math.max(1, ...shown.map(row => (row.added ?? 0) + (row.deleted ?? 0)))
  const testedScopes = new Set(r.rows.filter(row => isTest(row.path)).map(row => scopeOf(row.path)))
  const since = r.against === 'session start' && view.session ? ` (${ago(view.now - view.session.at)} ago)` : ''

  const header = (
    <Box key="header" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={pad}>
      <Box flexDirection="row" columnGap={1} flexShrink={1} flexWrap="wrap">
        <Text bold>{plural(r.rows.length, 'file')}</Text>
        <Text color="success">{`+${sum(r.rows, 'added')}`}</Text>
        <Text color="error">{`−${sum(r.rows, 'deleted')}`}</Text>
        <Text dimColor>{`vs ${r.against}${since} · ${r.branch}`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
        {s.refresh !== 'manual' && <Text color="success">●</Text>}
        {s.refresh !== 'manual' && <Text dimColor>live</Text>}
        {refresh}
      </Box>
    </Box>
  )
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

  if (s.budget) {
    const used = lines(reviewable)
    const over = used > s.budgetLines
    const color = over ? 'error' : used > s.budgetLines * 0.8 ? 'warning' : 'success'
    out.push(
      <Box key="budget" flexDirection="column" rowGap={isDesktop ? 0.5 : 0} marginTop={isDesktop ? 0.5 : 0} paddingX={pad}>
        {meter(view, 'budget-bar', used / s.budgetLines, color)}
        <Text color={over ? 'error' : undefined} dimColor={!over}>
          {`${used} of ${s.budgetLines} lines to review${over ? ' · over budget, consider a commit or a split' : ''}`}
        </Text>
      </Box>,
    )
  }

  if (s.guard) {
    const secrets = r.rows.filter(row => row.status === '??' && isSensitive(row.path))
    if (secrets.length)
      out.push(
        <Box key="secrets" paddingX={pad} marginTop={isDesktop ? 0.5 : 0}>
          <Text color="error">{`⚠ ${secrets.map(row => row.path).join(', ')} ${secrets.length === 1 ? 'looks sensitive and is' : 'look sensitive and are'} not in .gitignore`}</Text>
        </Box>,
      )
  }

  const groups = new Map<string, { order: number; rows: Row[] }>()
  for (const row of shown) {
    const g = groupOf(view, row)
    const known = groups.get(g.title) ?? { order: g.order, rows: [] }
    known.rows.push(row)
    groups.set(g.title, known)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
  let drawn = 0
  for (const [title, g] of ordered) {
    if (drawn >= ROWS) break
    const body: any[] = []
    if (title)
      body.push(
        <Box key={`group:${title}`} flexDirection="row" justifyContent="space-between" columnGap={2} paddingX={pad}>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {title}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{`+${sum(g.rows, 'added')} −${sum(g.rows, 'deleted')}`}</Text>
          </Box>
        </Box>,
      )
    for (const row of sorted(view, g.rows)) {
      if (drawn >= ROWS) break
      drawn += 1
      body.push(fileRow(view, row, max, s.group === 'folder', testedScopes))
      if (view.selected === row.path) {
        const more = details(view, row)
        if (more) body.push(more)
      }
    }
    out.push(
      <Box key={`rows:${title}`} flexDirection="column" marginTop={1} rowGap={s.density === 'comfortable' ? (isDesktop ? 0.5 : 1) : 0}>
        {body}
      </Box>,
    )
  }
  if (shown.length > drawn)
    out.push(
      <Box key="more" paddingX={pad}>
        <Text dimColor>{`⋮ ${shown.length - drawn} more`}</Text>
      </Box>,
    )

  if (generated.length)
    out.push(
      <Box key="generated" flexDirection="row" columnGap={1} marginTop={1} paddingX={pad} alignItems="center">
        <Text dimColor>{`${plural(generated.length, 'generated file')} ${view.showGenerated ? 'shown' : 'folded'} · ${generated.map(row => name(row.path)).slice(0, 3).join(', ')} · +${sum(generated, 'added')} −${sum(generated, 'deleted')}`}</Text>
        <Button key="generated-toggle" plain dimColor label={view.showGenerated ? 'Fold' : 'Show'} onPress={() => on.toggleGenerated()} />
      </Box>,
    )

  if (s.plan) {
    const plan = commitPlan(
      r.rows.filter(row => !row.isCommitted).map(row => row.path),
      s.planStyle,
    )
    if (plan.length) {
      const rows: any[] = [
        <Box key="plan-head" paddingX={pad}>
          <Text dimColor>Commit plan, by unit</Text>
        </Box>,
      ]
      for (const commit of plan)
        rows.push(
          <Box key={`plan:${commit.title}`} flexDirection="row" columnGap={1} paddingX={pad}>
            <Text dimColor>◆</Text>
            <Text>{commit.title}</Text>
            <Text dimColor>{plural(commit.paths.length, 'file')}</Text>
          </Box>,
        )
      out.push(
        <Box key="plan" flexDirection="column" marginTop={1} rowGap={isDesktop ? 0.25 : 0}>
          {isDesktop && <Box key="plan-rule" width="100%" height={0.06} backgroundColor={TRACK} marginBottom={0.5} />}
          {rows}
        </Box>,
      )
    }
  }

  return (
    <Box flexDirection="column" paddingY={isDesktop ? 0.5 : 0}>
      {out}
    </Box>
  )
}

function fileRow(view: View, row: Row, max: number, byFolder: boolean, testedScopes: Set<string>) {
  const { Box, Text, Button, settings: s, on, isDesktop } = view
  const label = byFolder ? name(row.path) : row.path
  const scope = `row:${row.path}`
  const right: any[] = []
  if (s.author && !row.isCommitted) {
    const who = row.touch?.who
    right.push(who === 'claude' ? pill(view, 'who', 'Claude', 'claude') : who === 'agent' ? pill(view, 'who', 'agent', 'agent') : who === 'shell' ? pill(view, 'who', 'shell', 'shell') : pill(view, 'who', 'you', 'you'))
  }
  if (s.churn && row.touch && row.touch.edits >= s.churnEdits) right.push(pill(view, 'churn', `↻ ×${row.touch.edits}`, 'warn'))
  if (s.guard && isSensitive(row.path)) right.push(pill(view, 'sensitive', 'sensitive', 'danger'))
  else if (s.guard && s.scope && !row.path.startsWith(s.scope)) right.push(pill(view, 'scope', 'outside scope', 'warn'))
  if (s.tests && isSource(row.path) && statusLetter(row.status) !== 'D' && !testedScopes.has(scopeOf(row.path))) right.push(pill(view, 'tests', 'no test', 'you'))

  if (s.bars !== 'off') {
    const cells = s.bars === 'blocks' ? 5 : 10
    const c = barCells(row.added, row.deleted, max, cells)
    const [full, empty] = s.bars === 'blocks' ? ['■', '□'] : ['━', '─']
    right.push(
      <Box key="bar" flexShrink={0} width={s.bars === 'blocks' ? 5.5 : 7}>
        <Text>
          {c.plus > 0 && <Text color="success">{full.repeat(c.plus)}</Text>}
          {c.minus > 0 && <Text color="error">{full.repeat(c.minus)}</Text>}
          {c.empty > 0 && <Text dimColor>{empty.repeat(c.empty)}</Text>}
        </Text>
      </Box>,
    )
  }
  const binary = row.added === null && row.deleted === null && row.status !== '??'
  right.push(cell(view, 'plus', W.plus, binary ? <Text dimColor>bin</Text> : row.added ? <Text color="success">{`+${row.added}`}</Text> : null))
  right.push(cell(view, 'minus', W.minus, row.deleted ? <Text color="error">{`−${row.deleted}`}</Text> : null))
  if (s.age) right.push(cell(view, 'age', W.age, row.changedAt !== undefined ? <Text dimColor>{ago(view.now - row.changedAt)}</Text> : null))

  // The path presses only with the peek on: it shows the diff, nothing more.
  const pressable = s.peek
  return (
    <Box key={scope} flexDirection="row" alignItems="center" columnGap={1} paddingX={isDesktop ? 0.5 : 0} hover={isDesktop ? { scope, backgroundColor: HOVER } : undefined}>
      <Box width={W.letter} flexShrink={0}>
        <Text color={statusColor(row.status)}>{statusLetter(row.status)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {pressable ? (
          <Box marginLeft={isDesktop ? -0.75 : 0}>
            <Button key={`file:${row.path}`} plain label={label} onPress={() => on.select(row.path)} />
          </Box>
        ) : (
          <Text wrap="truncate-start">{label}</Text>
        )}
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
        {right}
      </Box>
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
