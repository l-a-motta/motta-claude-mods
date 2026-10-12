import { describe, expect, test } from 'claude-code/testing'

import { ago, branchUrl, driftOf, httpsUrl, worktreeLabel, modelLabel, parseCommit, parsePr, parseStatus, prChange, whereOf } from '../hooks/register.tsx'
import type { Pr } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS, PR_JSON } from './session.tsx'

describe('parseStatus', () => {
  test('reads the branch, its upstream, and counts staged, modified and untracked files', () => {
    const out = '## dev...origin/dev [ahead 1, behind 2]\nM  a.ts\n M b.ts\nMM c.ts\n?? new.ts\n'
    expect(parseStatus(out)).toEqual({ branch: 'dev', staged: 2, modified: 2, untracked: 1, upstream: 'origin/dev', ahead: 1, behind: 2 })
  })

  test('reads a clean branch with no upstream', () => {
    expect(parseStatus('## feat/x\n')).toEqual({ branch: 'feat/x', staged: 0, modified: 0, untracked: 0, upstream: null, ahead: 0, behind: 0 })
  })

  test('reads a repository with no commits yet', () => {
    expect(parseStatus('## No commits yet on main\n').branch).toBe('main')
  })
})

describe('parseCommit and ago', () => {
  test('reads the last commit, or nothing from anything else', () => {
    expect(parseCommit('abc1234\x1f1700000000\x1fFix it\n')).toEqual({ hash: 'abc1234', at: 1_700_000_000_000, subject: 'Fix it' })
    expect(parseCommit('## dev\n')).toBeNull()
  })

  test('says how long ago', () => {
    expect([30_000, 12 * 60_000, 3 * 3_600_000, 2 * 86_400_000].map(ago)).toEqual(['just now', '12m ago', '3h ago', '2d ago'])
  })
})

describe('whereOf', () => {
  test('names the checkout, the folder below it, and the repository a worktree is of', () => {
    expect(whereOf('C:/code/app', 'C:/code/app', 'C:/code/app')).toEqual({ label: 'app', path: 'C:/code/app', worktreeOf: null })
    expect(whereOf('C:\\code\\app\\src', 'C:/code/app', 'C:/code/app').label).toBe('app/src')
    const wt = 'C:/code/app/.claude/worktrees/wt-1'
    expect(whereOf(wt, wt, 'C:/code/app')).toEqual({ label: 'wt-1', path: wt, worktreeOf: 'app' })
  })
})

describe('worktreeLabel', () => {
  test('names the repository only when the repo link does not', () => {
    expect(worktreeLabel('motta-claude-mods', 'motta-claude-mods')).toBe('worktree')
    expect(worktreeLabel('mods', 'motta-claude-mods')).toBe('worktree of mods')
    expect(worktreeLabel('mods', null)).toBe('worktree of mods')
  })
})

describe('driftOf', () => {
  test("says where the shell went from the root: below it, elsewhere, or nowhere", () => {
    expect(driftOf('C:/code/app', 'C:\\code\\app\\')).toBeNull()
    expect(driftOf('C:/code/app', 'C:\\code\\app\\plugins\\x')).toBe('plugins/x')
    expect(driftOf('C:/code/app', 'D:\\tmp')).toBe('D:/tmp')
  })
})

describe('branchUrl', () => {
  test('compares a branch against the default one, whose own tree it opens', () => {
    expect(branchUrl('https://github.com/o/r', 'feat/x', 'main')).toBe('https://github.com/o/r/compare/main...feat/x')
    expect(branchUrl('https://github.com/o/r', 'main', 'main')).toBe('https://github.com/o/r/tree/main')
  })
})

describe('modelLabel', () => {
  test('names Claude model ids the way /model does', () => {
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M context)')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  test('leaves anything else as given', () => {
    expect(modelLabel('opus[1m]')).toBe('opus[1m]')
  })
})

describe('parsePr', () => {
  test('counts checks, conflicts and the review the way GitHub shows them', () => {
    const pr = parsePr(PR_JSON)
    expect(pr.checks).toEqual({ total: 5, passed: 2, pending: 2, failed: ['lint'] })
    expect(pr.hasConflicts).toBe(true)
    expect(pr.isReady).toBe(false)
    expect(pr.review).toBe('pending')
  })
})

describe('prChange', () => {
  const base: Pr = {
    number: 482,
    url: 'u',
    state: 'OPEN',
    isDraft: false,
    base: 'main',
    hasConflicts: false,
    isBehind: false,
    isReady: false,
    review: 'pending',
    checks: { total: 3, passed: 1, pending: 2, failed: [] },
  }

  test('says when CI fails, passes or a conflict appears, in one line', () => {
    const failed = { ...base, hasConflicts: true, checks: { total: 3, passed: 2, pending: 0, failed: ['lint'] } }
    expect(prChange(base, failed)).toBe('#482 ✗ CI failed: lint · ⚠ now conflicts with main')
    const passed = { ...base, checks: { total: 3, passed: 3, pending: 0, failed: [] } }
    expect(prChange(base, passed)).toBe('#482 ✓ all checks passed')
    expect(prChange(base, { ...base, state: 'MERGED' })).toBe('#482 merged')
  })

  test('says nothing while nothing worth knowing changed', () => {
    expect(prChange(base, { ...base, checks: { total: 3, passed: 2, pending: 1, failed: [] } })).toBeNull()
  })
})

describe('httpsUrl', () => {
  test('turns ssh remotes into browsable urls', () => {
    expect(httpsUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r')
    expect(httpsUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r')
  })
})


test('draws both lines above the engine hint in the terminal hint line', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  expect(await ui.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5 \(1M context\) \| high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '360k/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'esc to interrupt' })).toBeDefined()
  await ui.unmount()
})

test('draws in the band on the desktop, which has no hint line, and leaves the terminal band free', async ($, on) => {
  answerSession(on)
  const desktop = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await desktop.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '360k/1M' })).toBeDefined()
  // The app's model picker already shows the model and effort.
  expect(await desktop.find({ type: 'Text', text: /Opus 5\.5/ })).toBeUndefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'motta-statusline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await terminal.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeUndefined()
  await terminal.unmount()
})
