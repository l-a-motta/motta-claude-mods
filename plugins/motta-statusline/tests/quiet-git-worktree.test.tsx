import { expect, test } from 'claude-code/testing'

import { answerSession, runs } from './session.tsx'

const REPO = 'C:/code/sample-app'
const WT = `${REPO}/.claude/worktrees/ui-tweaks`

// In a worktree, `.git` is a file naming the worktree's own git folder (HEAD,
// the index), and that folder's `commondir` names the repository's, where
// the refs are: a commit on the worktree's branch moves a ref there.
test("watches a worktree's own HEAD and index and its branch's ref in the repository", async ($, on) => {
  const mtimes: Record<string, number> = {
    [`${REPO}/.git/worktrees/ui-tweaks/HEAD`]: 1,
    [`${REPO}/.git/worktrees/ui-tweaks/index`]: 1,
    [`${REPO}/.git/refs/heads/feat/ui-tweaks`]: 1,
  }
  const stats: string[] = []
  const clock = answerSession(on, null, 'nothing', { cwd: WT, status: '## feat/ui-tweaks\n' })
  on('fs.stat', (_$: any, e: any) => {
    const path = String(e.path).replace(/\\/g, '/')
    stats.push(path)
    if (path === `${WT}/.git`) return { value: { kind: 'file', size: 60, mtimeMs: 0, isLink: false } }
    if (path in mtimes) return { value: { kind: 'file', size: 1, mtimeMs: mtimes[path], isLink: false } }
    throw new Error(`ENOENT ${path}`)
  })
  on('fs.read', (_$: any, e: any) => {
    const path = String(e.path).replace(/\\/g, '/')
    if (path === `${WT}/.git`) return { value: `gitdir: ${REPO}/.git/worktrees/ui-tweaks\n` }
    if (path === `${REPO}/.git/worktrees/ui-tweaks/commondir`) return { value: '../..\n' }
    throw new Error(`ENOENT ${path}`)
  })
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  await clock.advance(10_000)
  for (const path of Object.keys(mtimes)) expect(stats).toContain(path)

  const status = runs.filter(r => r.argv.includes('status')).length
  const log = runs.filter(r => r.argv.includes('log')).length
  await clock.advance(20_000)
  expect(runs.filter(r => r.argv.includes('status')).length).toBe(status)

  mtimes[`${REPO}/.git/refs/heads/feat/ui-tweaks`] = 2
  await clock.advance(10_000)
  expect(runs.filter(r => r.argv.includes('status')).length).toBe(status + 1)
  expect(runs.filter(r => r.argv.includes('log')).length).toBe(log + 1)
  await ui.unmount()
})
