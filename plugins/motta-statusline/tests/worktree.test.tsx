import { expect, test } from 'claude-code/testing'

import { answerSession, runs } from './session.tsx'

// In a worktree the repository's root is the main checkout, on another branch.
// git and gh run in the session's folder, so the line shows the worktree's
// branch and changes, and the PR is that branch's.
test("reads git and the PR in the session's worktree, not the repository's root", async ($, on) => {
  const cwd = 'C:/code/vtex-copilot-fse/.claude/worktrees/ui-tweaks'
  const clock = answerSession(on, null, 'nothing', { cwd, status: '## feat/ui-tweaks\n M manifest.json\n' })
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /feat\/ui-tweaks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~1/ })).toBeDefined()
  // The repository it is a worktree of: a two-folder icon, then the name.
  expect(await ui.find({ type: 'Text', text: '⧉' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'vtex-copilot-fse' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /worktree of/ })).toBeUndefined()
  expect(runs.find(r => r.argv[0] === 'git')?.cwd).toBe(cwd)
  expect(runs.find(r => r.argv[0] === 'gh')?.cwd).toBe(cwd)
  await ui.unmount()
})
