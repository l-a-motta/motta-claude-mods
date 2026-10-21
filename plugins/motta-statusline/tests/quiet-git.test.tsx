import { describe, expect, test } from 'claude-code/testing'

import { mayWrite, resolvePath, shouldRunGit } from '../hooks/register.tsx'
import { answerSession, runs } from './session.tsx'

const ROOT = 'C:/code/sample-app'

// git's own files under ROOT/.git, by path below ROOT, and their mtimes; a
// test moves one by bumping it.
const mtimes: Record<string, number> = {
  '.git/HEAD': 1,
  '.git/index': 1,
  '.git/refs/heads/dev': 1,
  '.git/refs/remotes/origin/dev': 1,
}

const count = (word: string) => runs.filter(r => r.argv.includes(word)).length
const ghCount = () => runs.filter(r => r.argv[0] === 'gh').length

// Each git or gh run is a process, in every open session: a tick runs git
// only when git's files moved, a tool call may have written, or the last run
// grew older than a minute (five once the session is idle).
test('runs git only when its files move, a tool call writes, or the fallback is due', async ($, on) => {
  const clock = answerSession(on, null, 'nothing', { cwd: ROOT, status: '## dev...origin/dev [ahead 1]\n M a.ts\n' })
  on('fs.stat', (_$: any, e: any) => {
    const path = String(e.path).replace(/\\/g, '/')
    if (path === `${ROOT}/.git`) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    const rel = path.slice(ROOT.length + 1)
    if (path.startsWith(`${ROOT}/`) && rel in mtimes) return { value: { kind: 'file', size: 1, mtimeMs: mtimes[rel], isLink: false } }
    throw new Error(`ENOENT ${path}`)
  })
  on('tool.call', () => ({ result: {} }))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  // The first reading, then the first tick's, which stats the branch's refs.
  await clock.advance(10_000)
  let status = count('status')
  let log = count('log')
  expect(status).toBe(2)

  // Nothing moved: no git for 40 s.
  await clock.advance(40_000)
  expect(count('status')).toBe(status)

  // A stage moves the index: status, and no log while the refs stand.
  mtimes['.git/index'] = 2
  await clock.advance(10_000)
  expect(count('status')).toBe(++status)
  expect(count('log')).toBe(log)

  // A commit moves HEAD's branch: status and log.
  mtimes['.git/refs/heads/dev'] = 2
  await clock.advance(10_000)
  expect(count('status')).toBe(++status)
  expect(count('log')).toBe(++log)

  // An edit changes the tree, which no git file shows: the next tick reads it.
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' } as never)
  await clock.advance(10_000)
  expect(count('status')).toBe(++status)

  // A read changes nothing (t = 80 s, the last run).
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/a.ts` } as never)
  await clock.advance(10_000)
  expect(count('status')).toBe(status)

  // A minute after the last run git runs anyway, for edits made outside Claude.
  await clock.advance(40_000)
  expect(count('status')).toBe(status)
  await clock.advance(10_000)
  expect(count('status')).toBe(++status)

  // Five minutes after the read the session is idle: git every five minutes,
  // and gh, with no PR, every ten.
  await clock.advance(310_000)
  status = count('status')
  const gh = ghCount()
  await clock.advance(220_000)
  expect(count('status')).toBe(status)
  expect(ghCount()).toBe(gh)
  await clock.advance(10_000)
  expect(count('status')).toBe(status + 1)
  await ui.unmount()
})

describe('shouldRunGit', () => {
  const at = { stamp: 'a', lastStamp: 'a', isTreeDirty: false, sinceRun: 10_000, fallback: 60_000 }
  test('skips while nothing moved', () => expect(shouldRunGit(at)).toBe(false))
  test('runs when git cannot be read', () => expect(shouldRunGit({ ...at, stamp: null, lastStamp: null })).toBe(true))
  test('runs when a file moved', () => expect(shouldRunGit({ ...at, stamp: 'b' })).toBe(true))
  test('runs after a write', () => expect(shouldRunGit({ ...at, isTreeDirty: true })).toBe(true))
  test('runs once the fallback is due', () => expect(shouldRunGit({ ...at, sinceRun: 60_000 })).toBe(true))
})

describe('mayWrite', () => {
  test('edits write', () => expect(['Edit', 'Write', 'NotebookEdit'].every(t => mayWrite(t, undefined))).toBe(true))
  test('a shell command writes unless found read-only', () => {
    expect(mayWrite('Bash', undefined)).toBe(true)
    expect(mayWrite('PowerShell', false)).toBe(true)
    expect(mayWrite('Bash', true)).toBe(false)
  })
  test('reads and searches do not', () => expect(['Read', 'Grep', 'Glob', 'WebFetch'].some(t => mayWrite(t, undefined))).toBe(false))
})

describe('resolvePath', () => {
  test("follows a worktree's commondir up to the repository's git folder", () => {
    expect(resolvePath('C:/code/app/.git/worktrees/ui', '../..')).toBe('C:/code/app/.git')
  })
  test('keeps an absolute gitdir, with forward slashes', () => {
    expect(resolvePath('C:/code/wt', 'C:\\code\\app\\.git\\worktrees\\ui')).toBe('C:/code/app/.git/worktrees/ui')
    expect(resolvePath('/home/me/wt', '/home/me/app/.git')).toBe('/home/me/app/.git')
  })
  test('resolves a relative gitdir against the checkout', () => {
    expect(resolvePath('/home/me/wt', '../app/.git/worktrees/wt')).toBe('/home/me/app/.git/worktrees/wt')
  })
})
