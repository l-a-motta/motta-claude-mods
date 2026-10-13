// changes-drill: a Changes pane that says what the desktop's diff view does
// not: which turn changed each file and who (Claude, a subagent, Claude's
// shell, or you outside Claude), against a baseline of your choice (HEAD, the
// session's start, the last turn, the base branch), with what to look at
// (sensitive files, files outside a scope, source without a test), and a
// History section under it: what's happening now, and a button to
// branch-drill's Branches pane (your branch and every branch). It only reads:
// nothing it draws stages, reverts or writes anything.
//
// It makes no model call, adds nothing to the model's context and makes no
// network call: the turns
// and touches come from the engine's own events, and the files from local git,
// read on open, on Refresh, and after a turn (or an edit) while the pane is up.
// With the pane closed, a turn that changed files is read once at its end, and
// only when an alert is on. Opened by /changes-drill, or by another mod
// through `$.changesDrill.open()` (motta-statusline's files).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChangesDrillOpened, ChangesDrillSnapshot, ChangesDrillTouch, ChangesDrillTurn } from '../types'
import { branchOf, isSensitive, numstat, parseChanges, parseNameStatus, repoPath, withNumstat } from './git.ts'
import type { Change } from './git.ts'
import { changesPane } from './pane.tsx'
import { LOG_FORMAT, parseCounts, parseFiles, parseLog } from './history.ts'
import { fit, historySection, setLevel, TOP } from './historyView.tsx'
import type { HistoryReading, Picks } from './historyView.tsx'

const PANE = 'changes-drill'

const turnsAtom = atom({ plugin: 'changes-drill', key: 'turns' } as const, [] as ChangesDrillTurn[])
const touchesAtom = atom({ plugin: 'changes-drill', key: 'touches' } as const, {} as Record<string, ChangesDrillTouch>)
const sessionAtom = atom({ plugin: 'changes-drill', key: 'session' } as const, null as ChangesDrillSnapshot | null)
const turnAtom = atom({ plugin: 'changes-drill', key: 'turn' } as const, null as ChangesDrillSnapshot | null)
const warnedAtom = atom({ plugin: 'changes-drill', key: 'warned' } as const, { sensitive: [] as string[] })

export type Settings = {
  group: 'turn' | 'folder' | 'author' | 'stage' | 'flat'
  baseline: 'HEAD' | 'session start' | 'last turn' | 'base branch'
  sort: 'recent' | 'lines' | 'path' | 'status'
  bars: 'blocks' | 'proportional' | 'off'
  density: 'compact' | 'comfortable'
  refresh: 'each turn' | 'each edit' | 'manual'
  age: boolean
  author: boolean
  churn: boolean
  churnEdits: number
  guard: boolean
  scope: string
  tests: boolean
  fold: boolean
  toast: boolean
  peek: boolean
  peekLines: number
  history: boolean
  historyDepth: number
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const count = (value: unknown, fallback: number, min: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback)

export function settingsOf(options: Record<string, unknown> | undefined): Settings {
  const o = options ?? {}
  return {
    group: pick(o.groupBy, ['turn', 'folder', 'author', 'stage', 'flat'], 'turn'),
    baseline: pick(o.baseline, ['HEAD', 'session start', 'last turn', 'base branch'], 'HEAD'),
    sort: pick(o.sort, ['recent', 'lines', 'path', 'status'], 'recent'),
    bars: pick(o.bars, ['blocks', 'proportional', 'off'], 'blocks'),
    density: pick(o.density, ['compact', 'comfortable'], 'compact'),
    refresh: pick(o.refresh, ['each turn', 'each edit', 'manual'], 'each turn'),
    age: flag(o.showAge, true),
    author: flag(o.showAuthor, true),
    churn: flag(o.churn, false),
    churnEdits: count(o.churnEdits, 5, 2),
    guard: flag(o.guard, true),
    scope: typeof o.scope === 'string' ? o.scope.trim().replace(/\\/g, '/').replace(/^\.?\//, '') : '',
    tests: flag(o.testHint, false),
    fold: flag(o.foldGenerated, false),
    toast: flag(o.turnToast, true),
    peek: flag(o.peek, false),
    peekLines: count(o.peekLines, 4, 1),
    history: flag(o.history, true),
    historyDepth: Math.min(200, count(o.historyDepth, 40, 5)),
  }
}

// A changed file as the pane draws it: the change, the last touch of it this
// session, when it last changed, and whether it is committed on the branch
// (the base-branch baseline) rather than in the work tree.
export type Row = Change & { touch?: ChangesDrillTouch; changedAt?: number; isCommitted: boolean }

// The last reading: the repository's root, the branch, the baseline it was
// read against, the rows and when; null outside a repository.
export type Reading = { top: string; branch: string; against: string; base: string; rows: Row[]; at: number }

// What the module keeps between draws; a reload starts it over, the reading
// included, which the next open or turn reads again.
let settings = settingsOf(undefined)
let reading: Reading | null = null
let isRead = false
let kicked = false
let isWindows: boolean | null = null
let shellRan = false
let selected: string | null = null
let showGenerated = false
// Turns before the last two, folded under one line until pressed.
let showOlder = false
let peekCache: { key: string; lines: string[] } | null = null
let editTimer: { cancel: () => void } | null = null
const tops = new Map<string, string | null>()
// The History section's own reading: undefined until the pane first draws
// it, null outside a repository. Read on open, on its Refresh, and at a
// turn's end when a ref moved; never with the pane closed.
let history: HistoryReading | null | undefined
let historyKicked = false
let isHistoryReading = false
let historyPrint = ''
let picks: Picks = { cur: 'story' }
let picksLoaded = false
const openRows = new Set<string>()
const commitFiles = new Map<string, [number, number, string][] | 'reading'>()
const filePeeks = new Map<string, readonly string[] | 'reading'>()
const mergeBases = new Map<string, { base: string; sha: string }>()

export const register: Register = (on, options) => {
  settings = settingsOf(options as Record<string, unknown> | undefined)

  // The noun's own answer is the bottom of its event; the hook on
  // `changesDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, changesDrill: { open: async (): Promise<ChangesDrillOpened> => ({ isPlaced: false, reason: 'changes-drill did not answer the call' }) } }
  })

  on('changesDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes-drill', description: 'Show the files changed, by turn and by who, with what to check and commit' })
    const result = await next(e)
    await backfill($)
    // A reload raises session.start again: the snapshot stays the first one.
    if (settings.baseline === 'session start' && (await read($, sessionAtom)) === null) {
      const top = await topOf($)
      const snap = top ? await snapshot($, top) : null
      if (snap) await update($, sessionAtom, () => snap)
    }
    return result
  })

  on('command.run', { command: 'changes-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Changes pane opened.' : `Changes pane waits: ${opened.reason ?? 'not placed'}` }
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if ((e as { agentId?: string }).agentId !== undefined) return result
    shellRan = false
    const now = await $.clock.now()
    const text = firstLine(e.text)
    await backfill($)
    await update($, turnsAtom, list => {
      // The transcript backfill may already hold this turn's prompt.
      const last = list[list.length - 1]
      if (last && last.id.startsWith('transcript:') && last.text === text) return [...list.slice(0, -1), { ...last, id: e.turnId, at: now }]
      return [...list, { n: (last?.n ?? 0) + 1, id: e.turnId, text, at: now }].slice(-200)
    })
    if (settings.baseline === 'last turn') {
      const top = await topOf($)
      const snap = top ? await snapshot($, top) : null
      if (snap) await update($, turnAtom, () => snap)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit' && e.tool !== 'Bash') return next(e)
    const result = await next(e)
    if (result.deny || result.isError) return result
    if (e.tool === 'Bash') {
      if (result.isReadOnly !== true) shellRan = true
      return result
    }
    const file = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    if (typeof file !== 'string' || !file) return result
    const key = await keyOf($, file)
    const now = await $.clock.now()
    const turn = (await read($, turnsAtom)).at(-1)?.n ?? 0
    const who = e.agentId === undefined ? 'claude' : 'agent'
    await update($, touchesAtom, all => ({ ...all, [key]: { who, turn, edits: (all[key]?.edits ?? 0) + 1, at: now } }))
    if (settings.refresh === 'each edit' && (await isUp($))) {
      editTimer?.cancel()
      editTimer = $.clock.after(600, () => void refresh($))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await historyAtTurnEnd($)
    if (e.agentId !== undefined || settings.refresh === 'manual') return result
    const up = await isUp($)
    const turn = (await read($, turnsAtom)).at(-1)?.n ?? 0
    const touched = Object.values(await read($, touchesAtom)).some(t => t.turn === turn)
    const alerts = settings.toast || settings.guard
    if (!up && !(alerts && (touched || shellRan))) return result
    const before = reading
    await readChanges($)
    if (shellRan && before && reading) await attributeShell($, before, reading, turn)
    shellRan = false
    await alert($, turn)
    if (up) $.ui.invalidate('ui.render')
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Code } = ui
    // A reload (an edit, an option changed) drops the reading: read once.
    if (!isRead && !kicked) {
      kicked = true
      void refresh($)
    }
    if (settings.history && history === undefined && !historyKicked) {
      historyKicked = true
      void readHistory($).then(() => $.ui.invalidate('ui.render'))
    }
    if (!picksLoaded) {
      picksLoaded = true
      try {
        const saved = (await $.store.get('historyPicks')) as Partial<Picks> | undefined
        if (saved && typeof saved === 'object') picks = { cur: saved.cur === 'files' ? 'files' : 'story' }
      } catch {
        // no store: the defaults stand.
      }
    }
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? 0
    // Everything the drawing reads, read first: the ladder draws it up to five
    // times, each from these values alone.
    const turns = await read($, turnsAtom)
    const session = await read($, sessionAtom)
    const now = await $.clock.now()
    const peek = selected && peekCache?.key === peekKey(selected) ? peekCache.lines : null
    const listOn = {
      refresh: () => void refresh($),
      select: (path: string) => void select($, path),
      toggleGenerated: () => {
        showGenerated = !showGenerated
        $.ui.invalidate('ui.render')
      },
      toggleOlder: () => {
        showOlder = !showOlder
        $.ui.invalidate('ui.render')
      },
    }
    const historyOn = {
      refresh: () => void readHistory($).then(() => $.ui.invalidate('ui.render')),
      pick: (section: keyof Picks, value: string) => {
        picks = { ...picks, [section]: value } as Picks
        void $.store.set('historyPicks', picks)
        $.ui.invalidate('ui.render')
      },
      toggle: (key: string, commit?: string) => void toggleRow($, key, commit),
      peek: (path: string) => void togglePeek($, path),
      branches: () => void openBranches($),
    }
    // The richest level whose tree the surface draws (see BUDGET in historyView.tsx).
    return fit(e.surface, TOP, level => {
      setLevel(level)
      // The list's cards that open downward from the root, drawn last of all.
      const floating: any[] = []
      const list = changesPane({
        Box,
        Text,
        Button,
        Code,
        isDesktop: e.surface === 'desktop',
        surface: e.surface,
        columns,
        floating,
        settings,
        reading: isRead ? reading : undefined,
        turns,
        session,
        now,
        selected,
        showGenerated,
        showOlder,
        peek,
        level,
        on: listOn,
      })
      if (!settings.history)
        return floating.length ? (
          <Box flexDirection="column" width="100%">
            {list}
            {floating}
          </Box>
        ) : (
          list
        )
      return (
        <Box flexDirection="column" width="100%">
          {list}
          {historySection({
            Box,
            Text,
            Button,
            Svg: 'Svg' in ui ? ui.Svg : undefined,
            Select: 'Select' in ui ? ui.Select : undefined,
            Code,
            surface: e.surface,
            columns,
            history,
            isReading: isHistoryReading,
            rows: isRead && reading ? reading.rows : [],
            picks,
            open: openRows,
            files: commitFiles,
            peeks: filePeeks,
            now,
            on: historyOn,
          })}
          {floating}
        </Box>
      )
    })
  })
}

// --- the Branches pane -----------------------------------------------------

// Opens branch-drill's Branches pane, where Me and All moved: a mod opens only
// its own panes, so it is asked through the noun branch-drill adds to `$`,
// missing when branch-drill is not installed.
async function openBranches($: EngineInterface) {
  try {
    const opened = await $.branchDrill.open()
    if (!opened.isPlaced) $.ui.toast(`Branches pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Me and All are in the Branches pane: install branch-drill from the motta-claude-mods marketplace')
  }
}

// --- the History section ---------------------------------------------------

// At a turn's end, while the pane is up: one cheap look at the refs, and a
// full read only when one moved.
async function historyAtTurnEnd($: EngineInterface) {
  if (!settings.history || history === undefined || !(await isUp($))) return
  const top = await topOf($)
  if (!top) return
  if ((await refsPrint($, top)) === historyPrint) return
  await readHistory($)
  $.ui.invalidate('ui.render')
}

// Every ref and what it points at, HEAD first: what moved since the last read.
async function refsPrint($: EngineInterface, top: string) {
  try {
    const run = await git($, top, ['show-ref', '--head'])
    return run.stdout
  } catch {
    return ''
  }
}

// The base line: origin's default branch, else origin/main, a local main or
// master. Local refs only; nothing is fetched.
async function baseOf($: EngineInterface, top: string) {
  const remote = await git($, top, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  const candidates = [remote.exitCode === 0 ? remote.stdout.trim() : '', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean)
  for (const ref of candidates) {
    const sha = await git($, top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (sha.exitCode === 0 && sha.stdout.trim()) return { ref, sha: sha.stdout.trim() }
  }
  return null
}

async function readHistory($: EngineInterface) {
  isHistoryReading = true
  $.ui.invalidate('ui.render')
  try {
    const top = await topOf($)
    if (!top) {
      history = null
      return
    }
    const [print, base, headRun, branchRun] = await Promise.all([refsPrint($, top), baseOf($, top), git($, top, ['rev-parse', '--verify', '--quiet', 'HEAD']), git($, top, ['rev-parse', '--abbrev-ref', 'HEAD'])])
    const head = headRun.exitCode === 0 ? headRun.stdout.trim() || null : null
    if (!head) {
      history = null
      historyPrint = print
      return
    }
    const log = await git($, top, ['log', `-n${settings.historyDepth}`, '--topo-order', `--format=${LOG_FORMAT}`, 'HEAD', '--branches', '--remotes'])
    const [counts, fork, behind, upstream] = await Promise.all([
      base ? git($, top, ['rev-list', '--left-right', '--count', `HEAD...${base.ref}`]) : null,
      base ? git($, top, ['merge-base', 'HEAD', base.ref]) : null,
      base ? git($, top, ['log', '-n20', `--format=${LOG_FORMAT}`, `HEAD..${base.ref}`]) : null,
      git($, top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ])
    const ab = counts && counts.exitCode === 0 ? parseCounts(counts.stdout) : null
    const up = upstream.exitCode === 0 ? upstream.stdout.trim() || null : null
    const unpushed = up ? parseCounts((await git($, top, ['rev-list', '--left-right', '--count', `HEAD...${up}`])).stdout)?.[0] ?? null : null
    history = {
      commits: log.exitCode === 0 ? parseLog(log.stdout) : [],
      head,
      branch: branchRun.exitCode === 0 ? branchRun.stdout.trim() : 'HEAD',
      base: base?.ref ?? null,
      main: base?.sha ?? null,
      fork: fork && fork.exitCode === 0 ? fork.stdout.trim() || null : null,
      ahead: ab?.[0] ?? 0,
      behind: ab?.[1] ?? 0,
      behindList: behind && behind.exitCode === 0 ? parseLog(behind.stdout) : [],
      upstream: up,
      unpushed,
      at: await $.clock.now(),
    }
    historyPrint = print
    commitFiles.clear()
  } catch {
    // git missing or slow: the last reading stays.
    if (history === undefined) history = null
  } finally {
    isHistoryReading = false
  }
}

// A row opened or closed; a commit's files read on its first opening only.
async function toggleRow($: EngineInterface, key: string, commit?: string) {
  if (openRows.has(key)) openRows.delete(key)
  else openRows.add(key)
  $.ui.invalidate('ui.render')
  if (!commit || !openRows.has(key) || commitFiles.has(commit)) return
  const top = await topOf($)
  if (!top) return
  commitFiles.set(commit, 'reading')
  try {
    const run = await git($, top, ['diff-tree', '-r', '--numstat', '--no-commit-id', '--root', '-m', '--first-parent', commit])
    commitFiles.set(commit, run.exitCode === 0 ? parseFiles(run.stdout) : [])
  } catch {
    commitFiles.set(commit, [])
  }
  $.ui.invalidate('ui.render')
}

// A changed file's first diff lines under its row in the files tree.
async function togglePeek($: EngineInterface, path: string) {
  const key = `f:${path}`
  if (openRows.has(key)) {
    openRows.delete(key)
    $.ui.invalidate('ui.render')
    return
  }
  openRows.add(key)
  filePeeks.set(path, 'reading')
  $.ui.invalidate('ui.render')
  const r = reading
  const row = r?.rows.find(x => x.path === path)
  let lines: string[] = []
  try {
    if (r && row?.status === '??') lines = trimHunk(['@@ -0,0 +1 @@', ...(await $.fs.read(`${r.top}/${row.path}`)).split('\n').map(l => `+${l.replace(/\r$/, '')}`)], 6)
    else if (r && row) lines = trimHunk((await git($, r.top, ['diff', '--no-color', '--no-ext-diff', '-U1', r.base, '--', row.path])).stdout.split('\n').map(l => l.replace(/\r$/, '')), 6)
  } catch {
    lines = []
  }
  filePeeks.set(path, lines)
  $.ui.invalidate('ui.render')
}

// --- tracking --------------------------------------------------------------

const firstLine = (text: string) => {
  const line = text.split('\n').find(l => l.trim())?.trim() ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

let isBackfilled = false

// The turns and Claude's edits from the session's own transcript, when this
// process tracked none yet: after a restart or a resume, or a mod enabled
// mid-session. One local read of the transcript; nothing reaches the model.
// Their times are unknown (0), so the files' own times stand in.
async function backfill($: EngineInterface) {
  if (isBackfilled) return
  isBackfilled = true
  if ((await read($, turnsAtom)).length || Object.keys(await read($, touchesAtom)).length) return
  let messages: unknown
  try {
    messages = await $.session.messages()
  } catch {
    return
  }
  if (!Array.isArray(messages)) return
  const turns: ChangesDrillTurn[] = []
  const touches: Record<string, ChangesDrillTouch> = {}
  for (const m of messages as { role: string; text: string; toolUses?: { tool: string; input: Record<string, unknown>; isError?: true }[]; toolResults?: unknown[] }[]) {
    if (m.role === 'user') {
      // A prompt: text that is not a tool result nor a command's own record.
      if (m.text.trim() && !m.toolResults?.length && !m.text.trimStart().startsWith('<')) turns.push({ n: turns.length + 1, id: `transcript:${turns.length + 1}`, text: firstLine(m.text), at: 0 })
      continue
    }
    for (const use of m.toolUses ?? []) {
      if ((use.tool !== 'Edit' && use.tool !== 'Write' && use.tool !== 'NotebookEdit') || use.isError) continue
      const file = use.input.file_path ?? use.input.notebook_path
      if (typeof file !== 'string' || !file) continue
      const key = await keyOf($, file)
      touches[key] = { who: 'claude', turn: turns.length, edits: (touches[key]?.edits ?? 0) + 1, at: 0 }
    }
  }
  if (!turns.length && !Object.keys(touches).length) return
  await update($, turnsAtom, list => (list.length ? list : turns.slice(-200)))
  await update($, touchesAtom, all => (Object.keys(all).length ? all : touches))
}

// --- reading ---------------------------------------------------------------

async function windows($: EngineInterface) {
  isWindows ??= (await $.env.get('OS')) === 'Windows_NT'
  return isWindows
}

// The touches' key for a file: its absolute path with forward slashes, lower
// case on Windows, so a tool's path and git's meet.
async function keyOf($: EngineInterface, file: string) {
  const path = file.replace(/\\/g, '/')
  const absolute = /^([a-z]:)?\//i.test(path) ? path : `${(await $.session.cwd()).replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`
  return (await windows($)) ? absolute.toLowerCase() : absolute
}

async function git($: EngineInterface, top: string, args: string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', top, ...args], { timeoutMs: 8_000 })
}

// The repository's root for the session's folder, once per folder.
async function topOf($: EngineInterface) {
  const cwd = await $.session.cwd()
  if (tops.has(cwd)) return tops.get(cwd) ?? null
  try {
    const run = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5_000 })
    const top = run.exitCode === 0 ? run.stdout.trim() : null
    tops.set(cwd, top)
    return top
  } catch {
    return null
  }
}

// A commit of the work tree as it stands, tracked files only, made without
// touching the stash list or any ref; HEAD when nothing is changed.
async function snapshot($: EngineInterface, top: string): Promise<ChangesDrillSnapshot | null> {
  try {
    const at = await $.clock.now()
    const made = await git($, top, ['stash', 'create'])
    const sha = made.exitCode === 0 ? made.stdout.trim() : ''
    if (sha) return { sha, at }
    const head = await git($, top, ['rev-parse', 'HEAD'])
    return head.exitCode === 0 ? { sha: head.stdout.trim(), at } : null
  } catch {
    return null
  }
}

// The base branch's merge base with HEAD: origin's default branch, else a
// local main or master. Local refs only; nothing is fetched.
async function mergeBase($: EngineInterface, top: string, branch: string) {
  const known = mergeBases.get(`${top}\n${branch}`)
  if (known) return known
  const remote = await git($, top, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  const candidates = [remote.exitCode === 0 ? remote.stdout.trim() : '', 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)
  for (const base of candidates) {
    if (base === branch) continue
    const mb = await git($, top, ['merge-base', 'HEAD', base])
    if (mb.exitCode === 0 && mb.stdout.trim()) {
      const found = { base: base.replace(/^origin\//, ''), sha: mb.stdout.trim() }
      mergeBases.set(`${top}\n${branch}`, found)
      return found
    }
  }
  return null
}

async function readChanges($: EngineInterface) {
  await backfill($)
  try {
    const top = await topOf($)
    if (!top) {
      reading = null
      isRead = true
      return
    }
    const status = await git($, top, ['status', '--porcelain=v1', '--branch'])
    if (status.exitCode !== 0) {
      reading = null
      isRead = true
      return
    }
    const branch = branchOf(status.stdout)
    const working = parseChanges(status.stdout)
    const now = await $.clock.now()
    let against = 'HEAD'
    let base = 'HEAD'
    let since = 0
    let changes: Change[]
    let committed = new Set<string>()
    if (settings.baseline === 'session start' || settings.baseline === 'last turn') {
      const snap = settings.baseline === 'session start' ? await read($, sessionAtom) : await read($, turnAtom)
      if (snap) {
        base = snap.sha
        since = snap.at
        against = settings.baseline === 'session start' ? 'session start' : 'last turn'
      }
    } else if (settings.baseline === 'base branch') {
      const mb = await mergeBase($, top, branch)
      if (mb) {
        base = mb.sha
        against = mb.base
      }
    }
    if (base === 'HEAD') {
      changes = working
      if (working.some(c => c.status !== '??')) {
        const stat = await git($, top, ['diff', '--numstat', '--no-renames', 'HEAD'])
        if (stat.exitCode === 0) changes = withNumstat(working, stat.stdout)
      }
    } else {
      const stat = await git($, top, ['diff', '--numstat', '--no-renames', base])
      const counts = stat.exitCode === 0 ? numstat(stat.stdout) : new Map<string, [number | null, number | null]>()
      const byPath = new Map(working.map(c => [c.path, c]))
      let named = new Map<string, Change>()
      if (settings.baseline === 'base branch') {
        const names = await git($, top, ['diff', '--name-status', '--no-renames', base])
        if (names.exitCode === 0) named = new Map(parseNameStatus(names.stdout).map(c => [c.path, c]))
      }
      changes = []
      for (const [path, [added, deleted]] of counts) {
        const own = byPath.get(path)
        if (!own) committed.add(path)
        changes.push({ status: own?.status ?? named.get(path)?.status ?? ' M', path, added, deleted })
      }
      for (const c of working) if (c.status === '??') changes.push(c)
      if (settings.baseline !== 'base branch') committed = new Set()
    }
    const touches = await read($, touchesAtom)
    const rows: Row[] = []
    for (const c of changes) {
      const key = await keyOf($, `${top.replace(/\\/g, '/')}/${c.path}`)
      rows.push({ ...c, touch: touches[key], isCommitted: committed.has(c.path) })
    }
    await withTimes($, top, rows, now)
    // An untracked file counts for a session or turn baseline only when it
    // changed after the snapshot.
    const kept = since ? rows.filter(r => r.status !== '??' || (r.changedAt ?? now) >= since || r.touch !== undefined) : rows
    reading = { top, branch, against, base, rows: kept, at: now }
    isRead = true
  } catch {
    // git missing or slow: the last reading stays.
  }
}

// Each row's last change (its touch, else the file's mtime) and an untracked
// file's lines, from the file itself: up to 200 files, 40 of them read.
async function withTimes($: EngineInterface, top: string, rows: Row[], now: number) {
  const wantsTime = settings.age || settings.sort === 'recent' || settings.baseline === 'session start' || settings.baseline === 'last turn'
  let reads = 0
  await Promise.all(
    rows.slice(0, 200).map(async row => {
      const path = `${top}/${row.path}`
      if (row.status === '??' && !row.path.endsWith('/') && reads < 40) {
        reads += 1
        try {
          const st = await $.fs.stat(path)
          row.changedAt = row.touch?.at || st.mtimeMs
          if (st.kind === 'file' && st.size < 512_000) {
            const text = await $.fs.read(path)
            if (!text.includes('\u0000')) row.added = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
          }
        } catch {
          // gone or unreadable: no count.
        }
        return
      }
      if (row.touch?.at) row.changedAt = row.touch.at
      else if (wantsTime && !row.status.includes('D') && !row.isCommitted) {
        try {
          row.changedAt = (await $.fs.stat(path)).mtimeMs
        } catch {
          row.changedAt = undefined
        }
      }
      if (row.changedAt !== undefined) row.changedAt = Math.min(row.changedAt, now)
    }),
  )
}

// Files that changed during a turn whose shell ran a command that writes, and
// that no Edit or Write of the turn named: Claude's shell changed them.
async function attributeShell($: EngineInterface, before: Reading, after: Reading, turn: number) {
  const was = new Map(before.rows.map(r => [r.path, r]))
  const now = await $.clock.now()
  const keys: string[] = []
  for (const row of after.rows) {
    if (row.touch?.turn === turn || row.isCommitted) continue
    const old = was.get(row.path)
    if (old && old.status === row.status && old.added === row.added && old.deleted === row.deleted) continue
    keys.push(await keyOf($, `${after.top.replace(/\\/g, '/')}/${row.path}`))
  }
  if (!keys.length) return
  await update($, touchesAtom, all => {
    const next = { ...all }
    for (const key of keys) next[key] = { who: 'shell', turn, edits: (all[key]?.edits ?? 0) + 1, at: now }
    return next
  })
  const touches = await read($, touchesAtom)
  for (const row of after.rows) {
    const key = await keyOf($, `${after.top.replace(/\\/g, '/')}/${row.path}`)
    row.touch = touches[key] ?? row.touch
    // A touch read back from the transcript has no time (0): keep the file's.
    if (row.touch?.at) row.changedAt = row.touch.at
  }
}

// The turn's toasts: what it changed, and a sensitive file that is not
// ignored (once each).
async function alert($: EngineInterface, turn: number) {
  const r = reading
  if (!r) return
  if (settings.toast) {
    const mine = r.rows.filter(row => row.touch?.turn === turn)
    if (mine.length) {
      const names = mine.slice(0, 2).map(row => row.path.slice(row.path.lastIndexOf('/') + 1))
      $.ui.toast(`Turn ${turn} changed ${mine.length} file${mine.length === 1 ? '' : 's'}: ${names.join(', ')}${mine.length > 2 ? ` +${mine.length - 2} more` : ''}`)
    }
  }
  const warned = await read($, warnedAtom)
  if (settings.guard) {
    const fresh = r.rows.filter(row => row.status === '??' && isSensitive(row.path) && !warned.sensitive.includes(row.path))
    for (const row of fresh.slice(0, 3)) $.ui.toast(`${row.path} looks sensitive and is not in .gitignore`)
    if (fresh.length) await update($, warnedAtom, w => ({ ...w, sensitive: [...w.sensitive, ...fresh.map(row => row.path)].slice(-100) }))
  }
}

// --- the pane -------------------------------------------------------------

async function isUp($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function open($: EngineInterface): Promise<ChangesDrillOpened> {
  await readChanges($)
  if (settings.history) {
    historyKicked = true
    await readHistory($)
  }
  const opened = await $.ui.open({ id: PANE, title: 'Changes' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

async function refresh($: EngineInterface) {
  mergeBases.clear()
  await readChanges($)
  if (selected) await loadPeek($, selected)
  $.ui.invalidate('ui.render')
}

const peekKey = (path: string) => `${reading?.at ?? 0}\n${path}`

async function select($: EngineInterface, path: string) {
  selected = selected === path ? null : path
  if (selected) await loadPeek($, selected)
  $.ui.invalidate('ui.render')
}

// The first lines of a file's diff against the baseline (an untracked file's
// own first lines), read when the row is pressed: one git call, none before.
async function loadPeek($: EngineInterface, path: string) {
  const r = reading
  const row = r?.rows.find(x => x.path === path)
  if (!settings.peek || !r || !row || peekCache?.key === peekKey(path)) return
  let lines: string[] = []
  try {
    if (row.status === '??') {
      if (!row.path.endsWith('/')) lines = trimHunk(['@@ -0,0 +1 @@', ...(await $.fs.read(`${r.top}/${row.path}`)).split('\n').map(l => `+${l.replace(/\r$/, '')}`)], settings.peekLines)
    } else {
      const diff = await git($, r.top, ['diff', '--no-color', '--no-ext-diff', '-U1', r.base, '--', row.path])
      lines = trimHunk(diff.stdout.split('\n').map(l => l.replace(/\r$/, '')), settings.peekLines)
    }
  } catch {
    lines = []
  }
  peekCache = { key: peekKey(path), lines }
}

// A diff's first hunk cut to `count` lines, its `@@` header counted again so
// the cut hunk still parses as one.
export function trimHunk(diff: readonly string[], count: number): string[] {
  const from = diff.findIndex(l => l.startsWith('@@'))
  if (from < 0) return []
  const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(diff[from] ?? '')
  if (!head) return []
  const body: string[] = []
  for (const line of diff.slice(from + 1)) {
    if (line.startsWith('@@') || body.length >= count) break
    if (line.startsWith('\\')) continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) body.push(line)
  }
  const old = body.filter(l => !l.startsWith('+')).length
  const now = body.filter(l => !l.startsWith('-')).length
  const at = (start: string, n: number) => (n === 0 ? `${Math.max(0, Number(start) - (start === '0' ? 0 : 1))},0` : `${Number(start) || 1},${n}`)
  return body.length ? [`@@ -${at(head[1] ?? '0', old)} +${at(head[2] ?? '0', now)} @@${head[3] ?? ''}`, ...body] : []
}
