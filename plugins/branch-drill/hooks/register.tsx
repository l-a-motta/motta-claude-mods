// branch-drill: a Branches pane on top of changes-drill. Its two sections
// moved here from the Changes pane's History, which keeps Current:
//   Me   your branch against main, or where your work sits
//   All  every branch as lanes or a subway map
// each with its own picker, hover cards, and a commit that opens its files.
// It only reads: nothing it draws stages, commits, pushes or fetches.
//
// No model call, nothing added to the model's context, no network: local git,
// read when the pane opens, on its Refresh, and at a turn's end while it is up
// (the full log only when a ref moved). Opened by /branch-drill, by the
// Changes pane's Branches button, or by another mod through
// `$.branchDrill.open()`.

import type { EngineInterface, Register } from 'claude-code'

import type { BranchDrillOpened } from '../types'
import { parseChanges, withNumstat } from './git.ts'
import type { Change } from './git.ts'
import { LOG_FORMAT, parseCounts, parseFiles, parseLog } from './history.ts'
import { branchesPane, fit, TOP } from './view.tsx'
import type { HistoryReading, Picks } from './view.tsx'

const PANE = 'branch-drill'

export type Settings = { historyDepth: number }

const count = (value: unknown, fallback: number, min: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback)

export function settingsOf(options: Record<string, unknown> | undefined): Settings {
  const o = options ?? {}
  return { historyDepth: Math.min(200, count(o.historyDepth, 40, 5)) }
}

// Who last changed a file through a tool, as changes-drill keeps it in its
// `touches` state: read when it is there, for the turn pills and the cards.
export type Touch = { who: 'claude' | 'agent' | 'shell'; turn: number; edits: number; at: number }
const touchesRef = { plugin: 'changes-drill', key: 'touches' } as const

// A changed file not committed yet: the change against HEAD and its last
// touch. `isCommitted` is always false here (the views share changes-drill's).
export type Row = Change & { touch?: Touch; isCommitted: boolean }

// What the module keeps between draws; a reload starts it over, the reading
// included, which the next draw reads again.
let settings = settingsOf(undefined)
let history: HistoryReading | null | undefined
let rows: Row[] = []
let kicked = false
let isReading = false
let historyPrint = ''
let picks: Picks = { me: 'tracks', all: 'lanes' }
let picksLoaded = false
let isWindows: boolean | null = null
const tops = new Map<string, string | null>()
const openRows = new Set<string>()
const commitFiles = new Map<string, [number, number, string][] | 'reading'>()

export const register: Register = (on, options) => {
  settings = settingsOf(options as Record<string, unknown> | undefined)

  // The noun's own answer is the bottom of its event; the hook on
  // `branchDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, branchDrill: { open: async (): Promise<BranchDrillOpened> => ({ isPlaced: false, reason: 'branch-drill did not answer the call' }) } }
  })

  on('branchDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'branch-drill', description: 'Show your branch against main and every branch as lanes or a subway map' })
    return next(e)
  })

  on('command.run', { command: 'branch-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Branches pane opened.' : `Branches pane waits: ${opened.reason ?? 'not placed'}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await atTurnEnd($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // A reload drops the reading: read once.
    if (history === undefined && !kicked) {
      kicked = true
      void readAll($).then(() => $.ui.invalidate('ui.render'))
    }
    if (!picksLoaded) {
      picksLoaded = true
      try {
        const saved = (await $.store.get('picks')) as Partial<Picks> | undefined
        if (saved && typeof saved === 'object') picks = { me: saved.me === 'places' ? 'places' : 'tracks', all: saved.all === 'subway' ? 'subway' : 'lanes' }
      } catch {
        // no store: the defaults stand.
      }
    }
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? 0
    const now = await $.clock.now()
    // The richest level whose tree the surface draws (see BUDGET in view.tsx).
    return fit(e.surface, TOP, level =>
      branchesPane({
        Box,
        Text,
        Button,
        Svg: 'Svg' in ui ? ui.Svg : undefined,
        Select: 'Select' in ui ? ui.Select : undefined,
        surface: e.surface,
        columns,
        history,
        isReading,
        rows,
        picks,
        open: openRows,
        files: commitFiles,
        now,
        level,
        on: {
          refresh: () => void refresh($),
          pick: (section, value) => void pick($, section, value),
          toggle: (key, commit) => void toggleRow($, key, commit),
        },
      }),
    )
  })
}

// --- the pane ---------------------------------------------------------------

async function isUp($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function open($: EngineInterface): Promise<BranchDrillOpened> {
  kicked = true
  await readAll($)
  const opened = await $.ui.open({ id: PANE, title: 'Branches' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

async function refresh($: EngineInterface) {
  await readAll($)
  $.ui.invalidate('ui.render')
}

async function pick($: EngineInterface, section: keyof Picks, value: string) {
  picks = { ...picks, [section]: value } as Picks
  $.ui.invalidate('ui.render')
  try {
    await $.store.set('picks', picks)
  } catch {
    // no store: the pick lasts until a reload.
  }
}

// At a turn's end, while the pane is up: the changed files again, and the log
// only when a ref moved.
async function atTurnEnd($: EngineInterface) {
  if (history === undefined || !(await isUp($))) return
  const top = await topOf($)
  if (!top) return
  rows = await readRows($, top)
  if ((await refsPrint($, top)) !== historyPrint) await readHistory($, top)
  $.ui.invalidate('ui.render')
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

// --- reading ----------------------------------------------------------------

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

async function readAll($: EngineInterface) {
  isReading = true
  $.ui.invalidate('ui.render')
  try {
    const top = await topOf($)
    if (!top) {
      history = null
      rows = []
      return
    }
    rows = await readRows($, top)
    await readHistory($, top)
  } finally {
    isReading = false
  }
}

// The files changed against HEAD, with their lines, and changes-drill's
// touch of each when it keeps one.
async function readRows($: EngineInterface, top: string): Promise<Row[]> {
  try {
    const status = await git($, top, ['status', '--porcelain=v1'])
    if (status.exitCode !== 0) return []
    let changes = parseChanges(status.stdout)
    if (changes.some(c => c.status !== '??')) {
      const stat = await git($, top, ['diff', '--numstat', '--no-renames', 'HEAD'])
      if (stat.exitCode === 0) changes = withNumstat(changes, stat.stdout)
    }
    const touches = await touchesOf($)
    const out: Row[] = []
    for (const c of changes) out.push({ ...c, touch: touches[await keyOf($, `${top.replace(/\\/g, '/')}/${c.path}`)], isCommitted: false })
    return out
  } catch {
    // git missing or slow: the last reading stays.
    return rows
  }
}

// changes-drill's touches, when it is loaded and keeps them; none otherwise.
async function touchesOf($: EngineInterface): Promise<Record<string, Touch>> {
  try {
    const { value } = await $.state.get(touchesRef)
    return value && typeof value === 'object' ? (value as Record<string, Touch>) : {}
  } catch {
    return {}
  }
}

async function windows($: EngineInterface) {
  isWindows ??= (await $.env.get('OS')) === 'Windows_NT'
  return isWindows
}

// The touches' key for a file, as changes-drill writes it: its absolute path
// with forward slashes, lower case on Windows.
async function keyOf($: EngineInterface, file: string) {
  const path = file.replace(/\\/g, '/')
  return (await windows($)) ? path.toLowerCase() : path
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

async function readHistory($: EngineInterface, top: string) {
  try {
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
  }
}
