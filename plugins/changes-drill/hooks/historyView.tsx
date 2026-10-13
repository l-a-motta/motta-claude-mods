// The History section under the list of changed files: a header with when it last read
// and its own Refresh, then three sections, each with a picker:
//   Me       your branch against main (two lines), or where your work sits
//   All      every branch as lanes (text art in the terminal), or a subway map
//   Current  what happened in sentences, or the changed files as a tree
// Pure drawing over what register.tsx read. On the desktop the graphs are
// static SVG images, one per row so each row stays pressable; a hover card is
// a hidden Box its row reveals; a branch's rows share one hover scope.

import type { Commit, Graph, Line, Work } from './history.ts'
import { MAIN, YOU, clock, colorOf, crossing, fileTree, layout, mainLine, prOf, shortBranch, shortSubject, subway, SYNC_MERGE, takenIn, workOf } from './history.ts'
import { ago, statusColor, statusLetter } from './git.ts'
import type { Row } from './register.tsx'

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

export type Picks = { me: 'tracks' | 'places'; all: 'lanes' | 'subway'; cur: 'story' | 'files' }

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
  }
}

// The desktop pane's own ground (dark theme), measured: what a hollow dot is filled with.
const BG = '#1a1a19'
const FG = '#e9e7e2'
const DIM = '#9c9a94'
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

type Ctx = HistoryViewArgs & { graphic: boolean; term: boolean; mobile: boolean }

export function historySection(args: HistoryViewArgs) {
  const { Box, Text, Button } = args
  const ctx: Ctx = { ...args, graphic: !!args.Svg && args.surface !== 'terminal', term: args.surface === 'terminal', mobile: args.surface === 'mobile' }
  const hr = args.history
  const status = args.isReading ? 'reading…' : hr ? `read ${clock(hr.at, args.now)} · GitHub as of last fetch` : ''
  const head = (
    <Box key="history-head" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingX={0.5} marginTop={1}>
      <Text bold>History</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {status}
        </Text>
        <Button key="history-refresh" plain dimColor label="↻ Refresh" onPress={() => args.on.refresh()} />
      </Box>
    </Box>
  )
  if (hr === undefined)
    return (
      <Box key="history" flexDirection="column" width="100%" overflow="hidden">
        {head}
        <Box paddingX={0.5}>
          <Text dimColor>Reading the history…</Text>
        </Box>
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
  cur: [
    ['story', 'Story'],
    ['files', 'Files tree'],
  ],
}

function section(ctx: Ctx, id: keyof Picks, name: string, sub: string, body: any) {
  const { Box, Text, Button, Select } = ctx
  const options = OPTIONS[id]
  const picker =
    Select && !ctx.mobile ? (
      <Select key={`history-pick-${id}`} value={ctx.picks[id]} options={options.map(([value, label]) => ({ value, label }))} onSelect={(v: string) => ctx.on.pick(id, v)} />
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

// A hover card over its row, opening upward (a row drawn later would paint
// over one hanging below): hidden, shown while the row is hovered. `rise` is
// the row's height in cells, so the card clears it.
function card(ctx: Ctx, key: string, left: number, lines: any[], rise = 1) {
  const { Box } = ctx
  if (ctx.mobile) return null
  return (
    <Box position="absolute" bottom={rise} left={Math.max(0, Math.round(left))} display="none" hover={{ display: 'flex' }} flexDirection="column" backgroundColor={CARD} paddingX={0.75} paddingY={ctx.term ? 0 : 0.3} width={36} borderStyle={ctx.term ? 'round' : undefined} borderColor={ctx.term ? RULE : undefined}>
      {lines}
    </Box>
  )
}

function commitCard(ctx: Ctx, c: Commit, w: Work | undefined) {
  const { Text } = ctx
  const s = shortSubject(c.subject)
  const kind = prOf(c.subject) ? ' (a PR merged into main)' : SYNC_MERGE.test(c.subject) ? ' (took main in)' : ''
  return [
    <Text key="a" wrap="truncate-end">
      <Text bold>{c.id.slice(0, 7)}</Text>
      <Text color={DIM}>{` · ${clock(c.at, ctx.now)} · ${c.author.split(" ")[0] ?? c.author}`}</Text>
    </Text>,
    <Text key="b" wrap="wrap">
      {s.lead ? `${s.lead} · ${s.rest}` : c.subject}
    </Text>,
    <Text key="c" color={DIM}>{`On ${w?.key === 'main' ? 'main' : w?.key === 'you' ? 'your branch' : w?.pr !== undefined ? `PR #${w.pr} · ${w.name}` : (w?.name ?? 'a branch')}${kind}`}</Text>,
    <Text key="d" color={DIM}>
      Click to see its files.
    </Text>,
  ]
}

function fileLines(ctx: Ctx, files: [number, number, string][] | 'reading' | undefined) {
  const { Box, Text } = ctx
  if (!files || files === 'reading') return [<Text key="reading" dimColor>{'Reading its files…'}</Text>]
  if (!files.length) return [<Text key="none" dimColor>{'No files changed.'}</Text>]
  const shown = [...files].sort((a, b) => b[0] + b[1] - (a[0] + a[1])).slice(0, 6)
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

function commitList(ctx: Ctx, list: readonly Commit[]) {
  const { Box, Text } = ctx
  return list.map(c => (
    <Box key={`cl:${c.id}`} flexDirection="row" columnGap={1}>
      <Text dimColor>{c.id.slice(0, 7)}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{shortSubject(c.subject).lead ? `${shortSubject(c.subject).lead} · ${shortSubject(c.subject).rest}` : c.subject}</Text>
      </Box>
      <Text dimColor>{clock(c.at, ctx.now)}</Text>
    </Box>
  ))
}

const draftCount = (rows: readonly Row[]) => rows.filter(r => !r.isCommitted).length

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
    ['me:behind', `${hr.behind} behind ${baseName}`, `Behind: commits ${baseName} has that your branch doesn't.`, hr.behind ? commitList(ctx, hr.behindList) : [<Text key="n" dimColor>{`Nothing: you have everything ${baseName} has, as of the last fetch.`}</Text>]],
    ['me:ahead', `${hr.ahead} ahead`, `Ahead: commits on your branch that ${baseName} doesn't have yet.`, hr.ahead ? commitList(ctx, hr.commits.filter(c => mineOnly(hr, c.id))) : [<Text key="n" dimColor>{files ? `No commits yet. Your ${plural(files, 'changed file')} become one when you commit.` : 'No commits yet.'}</Text>]],
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
          {card(ctx, key, 0, [
            <Text key="t" wrap="wrap">
              {explain}
            </Text>,
            <Text key="c" color={DIM}>
              Click to see what's in it.
            </Text>,
          ])}
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
      {card(
        ctx,
        key,
        2,
        [
          <Text key="t" wrap="wrap">
            {explain}
          </Text>,
        ],
        3,
      )}
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
      {card(ctx, `arrow:${key}`, 4, [
        <Text key="t" wrap="wrap">
          {explain}
        </Text>,
      ])}
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
  g.list.forEach((c, row) => {
    const key = c.id === DRAFT ? DRAFT : `c:${c.id}`
    const w = c.id === DRAFT ? { key: 'you', name: 'your branch' } : g.work.get(c.id)
    const scope = `br:${w?.key ?? c.id}`.slice(0, 64)
    const s = shortSubject(c.subject)
    const refs = c.refs.map(r => r.replace(/^HEAD -> /, '')).filter(r => r !== 'HEAD' && !r.endsWith('/HEAD'))
    const tags: any[] = []
    if (refs.includes((hr.base ?? '').replace(/^origin\//, ''))) tags.push(light(ctx, 'main', (hr.base ?? '').replace(/^origin\//, ''), 'ref'))
    if (hr.base && refs.includes(hr.base)) tags.push(light(ctx, 'origin', hr.base, 'cloud'))
    if (c.id === hr.head) tags.push(light(ctx, 'here', 'you are here', 'here'))
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
          ? card(ctx, key, colCells + 1, [
              <Text key="a" bold>
                Not committed yet
              </Text>,
              <Text key="b" color={DIM}>{`${plural(files, 'file')} changed since HEAD. Click to see them.`}</Text>,
            ])
          : card(ctx, key, colCells + 1, commitCard(ctx, c, w))}
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
  const older = (
    <Box key="older" flexDirection="row" alignItems="center" columnGap={0.75}>
      {ctx.graphic ? (
        <Box width={colCells} flexShrink={0}>
          <Svg alt="graph" width={g.width} height={H} source={slice(g, g.list.length)} />
        </Box>
      ) : (
        <Text>{art?.[g.list.length]}</Text>
      )}
      <Text dimColor>{`⋮ older than ${clock(hr.commits[hr.commits.length - 1]?.at ?? 0, ctx.now)}`}</Text>
    </Box>
  )
  out.push(older)
  return <Box flexDirection="column">{out}</Box>
}

function draftFiles(ctx: Ctx) {
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
      {c ? card(ctx, `stop-${key}`, 3, commitCard(ctx, c, w)) : null}
    </Box>,
  ]
  if (ctx.open.has(key)) rows.push(opened(ctx, key, c ? [<Text key="msg" wrap="wrap">{c.subject}</Text>, ...fileLines(ctx, ctx.files.get(c.id))] : draftFiles(ctx), 2))
  return rows
}

// --- Current · Story -------------------------------------------------------

function story(ctx: Ctx, hr: HistoryReading) {
  const { Box, Text, Button } = ctx
  const files = draftCount(ctx.rows)
  const baseName = (hr.base ?? 'main').replace(/^origin\//, '')
  const line = mainLine(hr.commits, hr.main)
  const onMain = new Set(line.map(c => c.id))
  const work = workOf(hr.commits, hr.head, hr.main)
  type Item = { key: string; color: string; hollow?: boolean; ring?: boolean; when: string; what: any; small: string; body: () => any[]; commit?: string }
  const items: Item[] = []
  if (files) {
    const turns = [...new Set(ctx.rows.filter(r => !r.isCommitted && r.touch).map(r => r.touch?.turn ?? 0))].sort((a, b) => a - b)
    items.push({ key: 'st:now', color: YOU, hollow: true, when: 'now', what: [`You have `, <Text key="b" bold>{plural(files, 'changed file')}</Text>, ` that aren't in a commit yet.`], small: turns.length ? `Claude changed them in turn${turns.length > 1 ? 's' : ''} ${turns.join(', ')}.` : 'Changed outside a turn of this session.', body: () => draftFiles(ctx) })
  }
  const behind = new Set(hr.behindList.map(c => c.id))
  for (const c of line.filter(c => behind.has(c.id)).slice(0, 4)) {
    const pr = prOf(c.subject)
    const taken = c.parents.length > 1 ? takenIn(hr.commits, c, onMain) : null
    items.push({ key: `st:${c.id}`, commit: c.id, color: colorOf(taken?.all[0] ? work.get(taken.all[0].id) : work.get(c.id)), when: clock(c.at, ctx.now), what: pr ? [`${baseName} moved ahead: `, <Text key="b" bold>{`PR #${pr.pr}`}</Text>, ` ${pr.name} was merged.`] : [`${baseName} moved ahead: “${c.subject}”.`], small: taken ? `${plural(taken.commits.length, 'commit')} your branch doesn't have yet.` : "A commit your branch doesn't have yet.", body: () => (taken ? commitList(ctx, taken.commits) : fileLines(ctx, ctx.files.get(c.id))) })
  }
  const by = new Map(hr.commits.map(c => [c.id, c]))
  const mine = hr.commits.filter(c => mineOnly(hr, c.id)).slice(0, 3)
  for (const c of mine) items.push({ key: `st:${c.id}`, commit: c.id, color: YOU, when: clock(c.at, ctx.now), what: [`You committed “${c.subject}”.`], small: c.id.slice(0, 7), body: () => fileLines(ctx, ctx.files.get(c.id)) })
  const fork = hr.fork ? by.get(hr.fork) : undefined
  if (fork && hr.branch !== baseName && hr.branch !== hr.base)
    items.push({ key: 'st:fork', color: YOU, ring: true, when: clock(fork.at, ctx.now), what: [<Text key="b" bold>You started this branch</Text>, ` from ${baseName}, right after “${joinSubject(fork.subject)}”.`], small: hr.branch, body: () => [<Text key="n" dimColor>{`Your branch began at ${fork.id.slice(0, 7)}. Every commit you make goes on top of it.`}</Text>] })
  const from = fork ? line.findIndex(c => c.id === fork.id) : line.findIndex(c => !behind.has(c.id))
  for (const c of line.slice(Math.max(0, from)).slice(0, Math.max(2, 7 - items.length))) {
    const pr = prOf(c.subject)
    const taken = c.parents.length > 1 ? takenIn(hr.commits, c, onMain) : null
    const n = taken?.commits.length ?? 0
    items.push({ key: `st:${c.id}`, commit: c.id, color: colorOf(taken?.all[0] ? work.get(taken.all[0].id) : work.get(c.id)), when: clock(c.at, ctx.now), what: pr ? [<Text key="b" bold>{`PR #${pr.pr}`}</Text>, ` ${pr.name} was merged into ${baseName}.`] : [`“${c.subject}” on ${baseName}.`], small: taken ? `${plural(n, 'commit')}${taken.syncs ? `, after ${taken.syncs === 1 ? 'one sync' : `${taken.syncs} syncs`} with ${baseName}` : ''}.` : c.id.slice(0, 7), body: () => (taken ? commitList(ctx, taken.commits) : fileLines(ctx, ctx.files.get(c.id))) })
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
          <Box flexDirection="row" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">
                {it.small}
              </Text>
            </Box>
            <Box marginRight={ctx.graphic ? -0.75 : 0}>
              <Button key={it.key} plain dimColor label={ctx.open.has(it.key) ? '▾' : '▸'} onPress={() => ctx.on.toggle(it.key, it.commit)} />
            </Box>
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
    const explain = r ? [<Text key="a" bold wrap="truncate-start">{r.path}</Text>, <Text key="b" color={DIM}>{`${letter === 'A' || letter === '?' ? 'New file' : letter === 'D' ? 'Deleted' : 'Changed'}${r.touch ? ` by ${r.touch.who === 'claude' ? 'Claude' : r.touch.who === 'agent' ? 'a subagent' : "Claude's shell"} in turn ${r.touch.turn}` : ''}${r.added ? ` · +${r.added}` : ''}${r.deleted ? ` −${r.deleted}` : ''}`}</Text>, <Text key="c" color={DIM}>Click for the first lines of its diff.</Text>] : [<Text key="a" bold>{n.parent === null ? 'Repository root' : n.label}</Text>, <Text key="b" color={DIM}>{`${plural(rows.filter(x => x.path.startsWith(n.key)).length, 'changed file')} below`}</Text>]
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
        {card(ctx, key, colCells + 1, explain)}
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
