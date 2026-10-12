// changes-drill: a Changes pane of each file changed against HEAD, its git
// status letter and its lines added and deleted.
//
// Read fresh on open and after each main-session turn while the pane is up.
// Opened by /changes-drill, or by another mod through the noun this mod adds
// to `$`, `$.changesDrill.open()`: a mod opens only its own panes, so
// motta-statusline's files asks this one to.

import type { EngineInterface, Register } from 'claude-code'

import type { ChangesDrillOpened } from '../types'

const PANE = 'changes-drill'

// One changed file: git's two-letter status, the path, and its lines added
// and deleted against HEAD (null for a binary file or one git has no count
// for, such as an untracked one).
export type Change = { status: string; path: string; added: number | null; deleted: number | null }

// The last reading: the branch and its changes, or null outside a repository.
type Reading = { branch: string; changes: Change[] }
let reading: Reading | null = null
let isRead = false

export const register: Register = on => {
  // The noun's own answer is the bottom of its event; the hook on
  // `changesDrill.open` below answers first with this mod's `$`.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, changesDrill: { open: async (): Promise<ChangesDrillOpened> => ({ isPlaced: false, reason: 'changes-drill did not answer the call' }) } }
  })

  on('changesDrill.open', async $ => ({ value: await open($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes-drill', description: 'Show the files changed against HEAD, with their lines' })
    return next(e)
  })

  on('command.run', { command: 'changes-drill' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'Changes pane opened.' : `Changes pane waits: ${opened.reason ?? 'not placed'}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && (await $.ui.panes()).some(p => p.id === PANE)) await refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return changesPane($, Box, Text, Button)
  })
}

async function readChanges($: EngineInterface) {
  try {
    const cwd = await $.session.cwd()
    const run = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], { cwd, timeoutMs: 5_000 })
    if (run.exitCode !== 0) {
      reading = null
    } else {
      let changes = parseChanges(run.stdout)
      if (changes.length > 0) {
        const stat = await $.process.run(['git', '--no-optional-locks', 'diff', '--numstat', 'HEAD'], { cwd, timeoutMs: 5_000 })
        if (stat.exitCode === 0) changes = withNumstat(changes, stat.stdout)
      }
      reading = { branch: branchOf(run.stdout), changes }
    }
    isRead = true
  } catch {
    // git missing or slow: the last reading stays.
  }
}

async function open($: EngineInterface): Promise<ChangesDrillOpened> {
  await readChanges($)
  const opened = await $.ui.open({ id: PANE, title: 'Changes' })
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

async function refresh($: EngineInterface) {
  await readChanges($)
  $.ui.invalidate('ui.render')
}

// Each changed file: its status letter, path, and lines added and deleted.
function changesPane($: EngineInterface, Box: any, Text: any, Button: any) {
  if (!isRead) return <Text dimColor>No reading yet.</Text>
  const r = reading
  const header = (text: string) => (
    <Box flexDirection="row" columnGap={1}>
      <Text color="subtle">{text}</Text>
      <Button key="refresh" plain dimColor label="Refresh" onPress={() => void refresh($)} />
    </Box>
  )
  if (r === null) return header('Not in a git repository.')
  if (r.changes.length === 0) return header(`Nothing changed on ${r.branch}.`)
  const added = r.changes.reduce((n, c) => n + (c.added ?? 0), 0)
  const deleted = r.changes.reduce((n, c) => n + (c.deleted ?? 0), 0)
  return (
    <Box flexDirection="column">
      {header(`${r.changes.length} files · +${added} −${deleted} against HEAD`)}
      {r.changes.map(c => (
        <Box key={c.path} flexDirection="row" columnGap={1}>
          <Text color={statusColor(c.status)}>{statusLetter(c.status)}</Text>
          <Box flexShrink={1}>
            <Text wrap="truncate-start">{c.path}</Text>
          </Box>
          {c.added !== null && <Text color="success">+{c.added}</Text>}
          {c.deleted !== null && <Text color="error">−{c.deleted}</Text>}
        </Box>
      ))}
    </Box>
  )
}

// The branch from `git status --branch`'s `## ` line.
export function branchOf(out: string) {
  const head = out.split('\n')[0]?.startsWith('## ') ? (out.split('\n')[0] ?? '').slice(3) : ''
  const name = head.startsWith('No commits yet on ') ? head.slice('No commits yet on '.length) : head
  return (name.split('...')[0] ?? '').split(' ')[0] || 'HEAD'
}

// The changed files of `git status --porcelain=v1`, a rename by its new path.
export function parseChanges(out: string): Change[] {
  return out
    .split('\n')
    .filter(line => line.length > 3 && !line.startsWith('## '))
    .map(line => {
      const path = line.slice(3)
      return { status: line.slice(0, 2), path: path.includes(' -> ') ? (path.split(' -> ')[1] ?? path) : path, added: null, deleted: null }
    })
}

// The changes with their lines from `git diff --numstat HEAD`: `added
// deleted path` per file, `-` for a binary one.
export function withNumstat(changes: Change[], out: string): Change[] {
  const counts = new Map<string, [number | null, number | null]>()
  for (const line of out.split('\n')) {
    const [added, deleted, path] = line.split('\t')
    if (path === undefined) continue
    counts.set(path, [added === '-' ? null : Number(added), deleted === '-' ? null : Number(deleted)])
  }
  return changes.map(c => {
    const n = counts.get(c.path)
    return n ? { ...c, added: n[0], deleted: n[1] } : c
  })
}

// `M`, `A`, `D`, `R`, `U` (a conflict) or `?` (untracked), from git's XY.
export function statusLetter(xy: string) {
  if (xy === '??') return '?'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'U'
  return (xy[0] !== ' ' ? xy[0] : xy[1]) ?? '?'
}

function statusColor(xy: string) {
  const letter = statusLetter(xy)
  if (letter === '?') return 'subtle'
  if (letter === 'A') return 'success'
  if (letter === 'D' || letter === 'U') return 'error'
  if (letter === 'R') return 'suggestion'
  return 'warning'
}
